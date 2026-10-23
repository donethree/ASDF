import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { artifactPath, atomicJson, optionalJson, uuid } from './artifacts.ts';
import { designTarget, pendingDesignRevision, sameDesignTarget, validateDesignTarget, type DesignTarget } from './approval.ts';
import { getItem, getItems, managedChildReason, setItem, setItemStage } from './items.ts';
import { assertItemOwner, isLocked, lockItem, unlockItem } from './lock.ts';
import { LIVE_RESERVATION_SECONDS, LIVE_WAIT_STAGES, assertLiveMutation, isLiveReserved, readLiveWatch, validateLiveKey, writeLiveWatch, type LiveKey, type LiveWatch } from './liveWatch.ts';
import { getConfig, withSettingsGuard } from './settings.ts';
import { readWorkerClaim, withItemGuard } from './workerLease.ts';
import { fail, isObject, now, same, toList } from './util.ts';

function interactive(): void {
  if (process.env.ASDF_WORKER_REQUEST) fail('ASDF_LIVE_INTERACTIVE_ONLY', 'unattended workers cannot control live watches');
}
function guarded<T>(id: number, action: () => T): T {
  interactive();
  return withSettingsGuard(() => withItemGuard(id, action));
}
function owned(id: number, owner: string, key?: LiveKey, at?: Date): LiveWatch | null {
  assertItemOwner(id, owner, at);
  if (readWorkerClaim(id)) fail('ASDF_LIVE_INTERACTIVE_ONLY', 'persistent worker owns this item');
  const watch = key ? validateLiveKey(id, key) : readLiveWatch(id);
  if (key && watch?.operationOwner !== owner) fail('ASDF_LOCK_NOT_OWNER', 'live operation owner changed');
  return watch;
}
function annotate(id: number, owner: string, watch: LiveWatch): void {
  const lock = optionalJson(artifactPath(id, '.lock'));
  if (!isObject(lock) || lock.owner !== owner) fail('ASDF_LOCK_NOT_OWNER', 'operation lock changed');
  atomicJson(artifactPath(id, '.lock'), { ...lock, liveWatchId: watch.watchId, liveGeneration: watch.generation });
}
export function prepareLiveWait(id: number, owner: string, threadId: string, rootItemId: number, at?: Date): LiveWatch {
  return guarded(id, () => {
    const previous = owned(id, owner, undefined, at);
    if (!uuid(threadId) || !Number.isSafeInteger(rootItemId) || rootItemId <= 0) fail('ASDF_BAD_ARGUMENT', 'live wait needs a thread UUID and root item ID');
    if (previous && isLiveReserved(previous, at) && previous.threadId !== threadId) fail('ASDF_LIVE_STALE', 'another thread has a live wait');
    const item = getItem(id);
    if (!LIVE_WAIT_STAGES.some(s => s === item.stage)) fail('ASDF_LIVE_NOT_WAITING', 'only design answer/approval and PR waits are monitored');
    if (rootItemId !== id) {
      const root = getItem(rootItemId);
      if (root.kind !== 'feature' || !same(root.org, item.org) || item.ado?.parentId !== rootItemId
        || !root.ado?.pbis?.some((p: { id: number }) => p.id === id)) fail('ASDF_LIVE_INVALID', 'item is not a recorded child of this Feature');
    }
    const target = designTarget(item);
    if (['awaiting-answers', 'awaiting-approval'].includes(item.stage)
      && (!target || (item.stage === 'awaiting-approval' ? !target.requestedAt : !target.roundPostedAt))) {
      fail('ASDF_LIVE_INVALID', 'a design wait needs its current request or question cutoff');
    }
    if (['pr-open', 'merging'].includes(item.stage) && !item.ado?.prId) fail('ASDF_LIVE_INVALID', 'PR wait needs a recorded PR');
    if (previous && previous.threadId === threadId && previous.status === 'armed' && isLiveReserved(previous, at) && previous.waitStage === item.stage
      && previous.prId === (item.ado?.prId ?? null)
      && ((!target && !previous.target) || (target && previous.target && sameDesignTarget(target, previous.target)))) return previous;
    const time = now(at);
    const watch: LiveWatch = { schemaVersion: 1, item: { id, org: item.org, project: item.project },
      threadId, rootItemId, watchId: previous?.threadId === threadId ? previous.watchId : randomUUID(),
      generation: (previous?.generation ?? 0) + 1, status: 'preparing', waitStage: item.stage, target,
      prId: item.ado?.prId ?? null, scheduleId: null, operationOwner: owner,
      lastSuccessfulCheckAt: null, expiresAt: new Date(time.getTime() + LIVE_RESERVATION_SECONDS * 1000).toISOString() };
    writeLiveWatch(id, watch);
    annotate(id, owner, watch);
    return watch;
  });
}
export function bindLiveSchedule(id: number, owner: string, key: LiveKey, scheduleId: number, at?: Date): LiveWatch {
  return guarded(id, () => {
    owned(id, owner, undefined, at);
    const watch = validateLiveKey(id, key);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) fail('ASDF_BAD_ARGUMENT', 'use the actual host schedule ID');
    if (watch.status === 'armed' && watch.scheduleId === scheduleId) return watch;
    if (watch.operationOwner !== owner) fail('ASDF_LIVE_STALE', 'watch is already bound or owned by another operation');
    if (watch.status !== 'preparing') fail('ASDF_LIVE_STALE', 'watch is not awaiting schedule registration');
    watch.scheduleId = scheduleId;
    watch.status = 'armed';
    watch.operationOwner = null;
    writeLiveWatch(id, watch);
    return watch;
  });
}
export function enterLiveCheck(id: number, key: LiveKey, owner: string, at?: Date): { acquired: boolean; watch: LiveWatch | null; reason: string | null } {
  return guarded(id, () => {
    const watch = validateLiveKey(id, key);
    // An interrupted check/arming turn is recoverable after its operation lock
    // is free or stale. Normal lock acquisition still protects a live owner.
    if (!lockItem(id, owner, at, key).acquired) return { acquired: false, watch, reason: 'another operation owns the item' };
    if (readWorkerClaim(id)) { unlockItem(id, owner); return { acquired: false, watch, reason: 'persistent worker owns the item' }; }
    // A working generation inherited a retired timer, not a timer for this key.
    if (!['armed', 'checking'].includes(watch.status)) watch.scheduleId = null;
    watch.status = 'checking';
    watch.operationOwner = owner;
    writeLiveWatch(id, watch);
    return { acquired: true, watch, reason: watch.scheduleId === null ? 'host schedule needs reconciliation' : null };
  });
}
export function finishLiveCheck(id: number, key: LiveKey, owner: string, readsSucceeded: boolean, at?: Date): LiveWatch {
  return guarded(id, () => {
    const watch = owned(id, owner, key, at)!;
    if (watch.status !== 'checking') fail('ASDF_LIVE_STALE', 'no live check is in progress');
    if (typeof readsSucceeded !== 'boolean') fail('ASDF_BAD_ARGUMENT', 'ReadsSucceeded must be true or false');
    if (readsSucceeded) {
      const item = getItem(id);
      const target = designTarget(item);
      if (item.stage !== watch.waitStage || (item.ado?.prId ?? null) !== watch.prId
        || (target && watch.target ? !sameDesignTarget(target, watch.target) : target !== watch.target)) {
        fail('ASDF_LIVE_TARGET_CHANGED', 'state changed; suspend and continue or rearm against the new target');
      }
      watch.lastSuccessfulCheckAt = now(at).toISOString();
      watch.expiresAt = new Date(now(at).getTime() + LIVE_RESERVATION_SECONDS * 1000).toISOString();
    }
    watch.status = 'armed';
    watch.operationOwner = null;
    writeLiveWatch(id, watch);
    unlockItem(id, owner);
    return watch;
  });
}
export function suspendLiveWatch(id: number, key: LiveKey, owner: string): LiveWatch {
  return guarded(id, () => {
    const watch = owned(id, owner, key)!;
    watch.generation++;
    watch.status = 'working';
    writeLiveWatch(id, watch);
    annotate(id, owner, watch);
    return watch;
  });
}
export function stopLiveWatch(id: number, key: LiveKey, owner: string): LiveWatch {
  return guarded(id, () => {
    const existing = readLiveWatch(id);
    if (existing?.status === 'stopped' && existing.watchId === key.watchId && existing.generation === key.generation + 1) return existing;
    const watch = owned(id, owner, key)!;
    watch.status = 'stopped';
    watch.operationOwner = null;
    watch.generation++;
    writeLiveWatch(id, watch);
    unlockItem(id, owner);
    return watch;
  });
}

export type LiveInteraction = {
  schemaVersion: 1; interactionId: string; itemId: number; key: LiveKey;
  kind: 'approval' | 'feedback'; target: DesignTarget; receivedAt: string;
  author: string; summary: string; recordedCommentId: number | null; status: 'pending' | 'recorded';
};
function interactionPath(id: number, interactionId: string): string {
  if (!uuid(interactionId)) fail('ASDF_BAD_ARGUMENT', 'interaction ID must be a UUID');
  return artifactPath(id, 'live-interactions', `${interactionId}.json`);
}
function ownsDesign(item: ReturnType<typeof getItem>): boolean {
  return item.hld?.designDriver !== 'shared' && (item.ado?.hldOwned === true || (item.kind === 'feature' && item.ado?.hldId === item.id));
}
function currentTarget(id: number, expected: DesignTarget): DesignTarget {
  const target = designTarget(getItem(id));
  if (!target || !sameDesignTarget(target, validateDesignTarget(expected))) fail('ASDF_LIVE_TARGET_CHANGED', 'design version/request changed; refresh and present it before applying chat approval');
  return target;
}
function readInteraction(id: number, interactionId: string): LiveInteraction {
  const v = optionalJson(interactionPath(id, interactionId));
  if (!isObject(v) || v.schemaVersion !== 1 || v.interactionId !== interactionId || v.itemId !== id
    || !isObject(v.key) || !uuid(v.key.watchId) || !Number.isSafeInteger(v.key.generation)
    || !['approval', 'feedback'].includes(v.kind) || !['pending', 'recorded'].includes(v.status)
    || typeof v.author !== 'string' || typeof v.summary !== 'string'
    || !Number.isFinite(Date.parse(v.receivedAt))
    || !(v.recordedCommentId === null || (Number.isSafeInteger(v.recordedCommentId) && v.recordedCommentId > 0))) {
    fail('ASDF_LIVE_INVALID', 'invalid live interaction');
  }
  return { schemaVersion: 1, interactionId, itemId: id, key: { watchId: v.key.watchId, generation: v.key.generation },
    kind: v.kind, target: validateDesignTarget(v.target), receivedAt: v.receivedAt, author: v.author, summary: v.summary,
    recordedCommentId: v.recordedCommentId, status: v.status };
}
function pendingInteractions(id: number): LiveInteraction[] {
  let names: string[];
  try { names = readdirSync(artifactPath(id, 'live-interactions')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names.filter(name => name.endsWith('.json') && uuid(name.slice(0, -5)))
    .map(name => readInteraction(id, name.slice(0, -5))).filter(r => r.status === 'pending');
}
function ensureFeedbackMarker(id: number, receipt: LiveInteraction): void {
  currentTarget(id, receipt.target);
  const current = pendingDesignRevision(getItem(id));
  if (current && current.feedbackId !== receipt.interactionId) {
    fail('ASDF_DESIGN_REVISION_PENDING', 'a different feedback receipt is pending; do not overwrite it');
  }
  if (!current) {
    setItem(id, { hld: { pendingFeedback: { feedbackId: receipt.interactionId, target: receipt.target,
      receivedAt: receipt.receivedAt, source: 'session', recordedAt: null, consumedAt: null, delegatedAt: null } } });
  }
  if (getItem(id).stage !== 'answers-received') setItemStage(id, 'answers-received', 'feedback in live session');
}
export function beginLiveInteraction(id: number, key: LiveKey, owner: string,
  input: { kind: 'approval' | 'feedback'; target: DesignTarget; author: string; summary: string }): LiveInteraction {
  return guarded(id, () => {
    const watch = owned(id, owner, key)!;
    if (watch.status !== 'working') fail('ASDF_LIVE_STALE', 'suspend the waiting generation before recording chat input');
    if (!isObject(input)) fail('ASDF_BAD_ARGUMENT', 'interaction must be an object');
    const target = currentTarget(id, input.target);
    if (!watch.target || !sameDesignTarget(watch.target, target)) fail('ASDF_LIVE_TARGET_CHANGED', 'chat input belongs to the previously presented design');
    const item = getItem(id);
    if (!ownsDesign(item)) fail('ASDF_DESIGN_NOT_OWNED', 'shared designs must be approved or revised by their owner in ADO');
    if (!['approval', 'feedback'].includes(input.kind) || typeof input.author !== 'string' || !input.author.trim()
      || typeof input.summary !== 'string' || !input.summary.trim()) fail('ASDF_BAD_ARGUMENT', 'interaction needs kind, author and summary');
    const pendingReceipts = pendingInteractions(id).filter(r => sameDesignTarget(r.target, target));
    const retry = pendingReceipts.find(r => r.kind === input.kind && r.author === input.author && r.summary === input.summary);
    if (retry) {
      if (retry.kind === 'feedback') ensureFeedbackMarker(id, retry);
      return retry;
    }
    if (pendingReceipts.some(r => r.kind === 'feedback') || pendingDesignRevision(item)) {
      fail('ASDF_DESIGN_REVISION_PENDING', 'resolve the existing feedback before accepting additional changes');
    }
    if (input.kind === 'approval' && (item.stage !== 'awaiting-approval' || pendingDesignRevision(item))) {
      fail('ASDF_DESIGN_REVISION_PENDING', 'only the current requested design without pending feedback can be approved');
    }
    if (input.kind === 'feedback' && !['awaiting-answers', 'awaiting-approval', 'answers-received', 'approved'].includes(item.stage)) {
      fail('ASDF_LIVE_NOT_WAITING', 'this feedback is not for an active design review');
    }
    const receipt: LiveInteraction = { schemaVersion: 1, interactionId: randomUUID(), itemId: id,
      key: { watchId: key.watchId, generation: key.generation }, kind: input.kind, target, receivedAt: new Date().toISOString(),
      author: input.author, summary: input.summary, recordedCommentId: null, status: 'pending' };
    atomicJson(interactionPath(id, receipt.interactionId), receipt);
    if (input.kind === 'feedback') ensureFeedbackMarker(id, receipt);
    return receipt;
  });
}
export function recordLiveInteraction(id: number, key: LiveKey, owner: string, interactionId: string, commentId: number): LiveInteraction {
  return guarded(id, () => {
    owned(id, owner, key);
    const receipt = readInteraction(id, interactionId);
    if (receipt.kind === 'feedback') return recordDesignFeedback(id, owner, interactionId, commentId);
    currentTarget(id, receipt.target);
    if (!Number.isSafeInteger(commentId) || commentId <= 0) fail('ASDF_BAD_ARGUMENT', 'use the confirmed ADO comment ID');
    if (receipt.recordedCommentId !== null && receipt.recordedCommentId !== commentId) fail('ASDF_LIVE_INVALID', 'receipt is already bound to another comment');
    const item = getItem(id);
    if (!ownsDesign(item)) fail('ASDF_DESIGN_NOT_OWNED', 'design ownership changed');
    if (receipt.kind === 'approval' && pendingDesignRevision(item)) fail('ASDF_DESIGN_REVISION_PENDING', 'later feedback prevents this approval');
    receipt.recordedCommentId = commentId;
    receipt.status = 'recorded';
    atomicJson(interactionPath(id, interactionId), receipt);
    const time = new Date().toISOString();
    if (item.stage === 'awaiting-approval') {
      setItem(id, { hld: { approvedBy: `${receipt.author} (session)`, approvedAt: receipt.receivedAt,
        ...(item.ado.hldOwned ? { closedAt: time } : {}) } });
      setItemStage(id, 'approved', 'approved in live session');
    }
    return receipt;
  });
}
export function publishDesignRequest(id: number, owner: string, expected: DesignTarget, version: number, requestedAt: string): DesignTarget {
  return withSettingsGuard(() => withItemGuard(id, () => {
    checkDesignRequest(id, owner, expected, version, requestedAt);
    setItem(id, { hld: { version, approvalRequestedAt: requestedAt, pendingFeedback: null, approvedBy: null, approvedAt: null, closedAt: null } });
    setItemStage(id, 'awaiting-approval');
    return designTarget(getItem(id))!;
  }));
}
export function checkDesignRequest(id: number, owner: string, expected: DesignTarget, version: number, requestedAt: string): DesignTarget {
  return withSettingsGuard(() => withItemGuard(id, () => {
    assertItemOwner(id, owner);
    assertLiveMutation(id, owner);
    readDesignFeedback(id, owner);
    const target = currentTarget(id, expected);
    const item = getItem(id);
    if (!ownsDesign(item)) fail('ASDF_DESIGN_NOT_OWNED', 'cannot publish a shared design');
    const pending = pendingDesignRevision(item);
    if (!Number.isSafeInteger(version) || version <= target.version || !Number.isFinite(Date.parse(requestedAt))
      || Date.parse(requestedAt) < Date.parse(target.requestedAt ?? '1970-01-01')) fail('ASDF_BAD_ARGUMENT', 'publish a newer version and request cutoff');
    if (pending && (!pending.recordedAt || !pending.consumedAt || Date.parse(requestedAt) <= Date.parse(pending.receivedAt))) {
      fail('ASDF_DESIGN_REVISION_PENDING', 'record and consume feedback before publishing the revised request');
    }
    return target;
  }));
}
export function readDesignFeedback(id: number, owner?: string, at?: string | Date) {
  return withSettingsGuard(() => withItemGuard(id, () => {
    if (owner !== undefined) {
      assertItemOwner(id, owner, at);
      assertLiveMutation(id, owner);
    }
    let pending = pendingDesignRevision(getItem(id));
    if (!pending) {
      const target = designTarget(getItem(id));
      const receipt = pendingInteractions(id).find(r => r.kind === 'feedback' && target && sameDesignTarget(r.target, target));
      if (receipt) {
        if (!owner) fail('ASDF_LOCK_NOT_OWNER', 'acquire the item operation to recover pending feedback before applying signals');
        ensureFeedbackMarker(id, receipt);
        pending = pendingDesignRevision(getItem(id));
      }
    }
    return { pending, interaction: pending?.source === 'session' ? readInteraction(id, pending.feedbackId) : null };
  }));
}
export function recordDesignFeedback(id: number, owner: string, interactionId: string, commentId: number): LiveInteraction {
  return withSettingsGuard(() => withItemGuard(id, () => {
    assertItemOwner(id, owner);
    assertLiveMutation(id, owner);
    const receipt = readInteraction(id, interactionId);
    if (receipt.kind !== 'feedback') fail('ASDF_BAD_ARGUMENT', 'fresh-owner reconciliation is only for feedback, not old approvals');
    if (!Number.isSafeInteger(commentId) || commentId <= 0) fail('ASDF_BAD_ARGUMENT', 'use the confirmed ADO comment ID');
    if (receipt.recordedCommentId !== null && receipt.recordedCommentId !== commentId) fail('ASDF_LIVE_INVALID', 'receipt already refers to another comment');
    const pending = pendingDesignRevision(getItem(id));
    if (!pending && receipt.status === 'recorded') return receipt;
    if (pending?.feedbackId === interactionId && pending.recordedAt && receipt.status === 'recorded') return receipt;
    ensureFeedbackMarker(id, receipt);
    receipt.recordedCommentId = commentId; receipt.status = 'recorded';
    atomicJson(interactionPath(id, interactionId), receipt);
    setItem(id, { hld: { pendingFeedback: { ...pendingDesignRevision(getItem(id)), recordedAt: new Date().toISOString() } } });
    return receipt;
  }));
}
export function consumeDesignFeedback(id: number, owner: string, feedbackId: string, summary: string) {
  return withSettingsGuard(() => withItemGuard(id, () => {
    assertItemOwner(id, owner); assertLiveMutation(id, owner);
    const pending = pendingDesignRevision(getItem(id));
    if (!pending || pending.feedbackId !== feedbackId || !pending.recordedAt || typeof summary !== 'string' || !summary.trim()) {
      fail('ASDF_DESIGN_REVISION_PENDING', 'read and record the current feedback before acknowledging its resolution');
    }
    setItem(id, { hld: { pendingFeedback: { ...pending, consumedAt: new Date().toISOString(), resolution: summary } } });
    return pendingDesignRevision(getItem(id));
  }));
}
export function observeDesignDriver(id: number, owner: string, mode: 'owned' | 'shared') {
  return withSettingsGuard(() => withItemGuard(id, () => {
    assertItemOwner(id, owner); assertLiveMutation(id, owner);
    if (!['owned', 'shared'].includes(mode)) fail('ASDF_BAD_ARGUMENT', 'design driver mode must be owned or shared');
    const item = getItem(id);
    if (mode === 'owned' && !(item.ado?.hldOwned === true || (item.kind === 'feature' && item.ado?.hldId === id))) fail('ASDF_DESIGN_NOT_OWNED', 'this item does not drive the design');
    const pending = pendingDesignRevision(item);
    if (mode === 'shared' && pending && (!pending.recordedAt || !pending.consumedAt)) {
      fail('ASDF_DESIGN_REVISION_PENDING', 'record and forward pending feedback before handing it to the shared design owner');
    }
    const cutoff = Math.max(Date.parse(item.hld?.approvalRequestedAt ?? '1970-01-01'),
      pending ? Date.parse(pending.receivedAt) : 0,
      pending?.source === 'session' && pending.recordedAt ? Date.parse(pending.recordedAt) : 0);
    setItem(id, { hld: { designDriver: mode,
      ...(pending ? { pendingFeedback: { ...pending, delegatedAt: mode === 'shared' ? new Date().toISOString() : null } } : {}),
      ...(mode === 'shared' && pending ? { approvalRequestedAt: new Date(cutoff).toISOString() } : {}) } });
    return getItem(id);
  }));
}
export function selectLiveChild(featureId: number, input: unknown, visited: number[]): { id: number | null; deferred: number[] } {
  const feature = getItem(featureId);
  if (feature.kind !== 'feature' || !Array.isArray(input) || !Array.isArray(visited)) fail('ASDF_BAD_ARGUMENT', 'selection needs a Feature and complete child snapshot');
  const entries = toList(feature.ado?.pbis);
  const children = new Map<number, { id: number; assignedToMe: boolean; parentId: number; stateCategory: string; type: string }>();
  for (const v of input) {
    if (!isObject(v) || !Number.isSafeInteger(v.id) || v.id <= 0 || typeof v.assignedToMe !== 'boolean'
      || !Number.isSafeInteger(v.parentId) || typeof v.stateCategory !== 'string' || typeof v.type !== 'string' || children.has(v.id)) {
      fail('ASDF_LIVE_REFRESH_INCOMPLETE', 'invalid or duplicate child snapshot');
    }
    children.set(v.id, { id: v.id, assignedToMe: v.assignedToMe, parentId: v.parentId, stateCategory: v.stateCategory, type: v.type });
  }
  if (entries.some(entry => !children.has(entry.id))) fail('ASDF_LIVE_REFRESH_INCOMPLETE', 'refresh every recorded child before selection');
  const items = getItems();
  const types: string[] = getConfig().workItemTypes.parent;
  const deferred: number[] = [];
  for (const entry of entries) {
    const child = children.get(entry.id)!;
    if (visited.includes(child.id) || ['Completed', 'Removed'].includes(child.stateCategory)) continue;
    const local = items.find(i => i.id === child.id && same(i.org, feature.org));
    if (!child.assignedToMe || child.parentId !== featureId || !types.some(t => same(t, child.type))
      || !['InProgress', 'Resolved'].includes(child.stateCategory)
      || toList(entry.waitsFor).some(id => children.get(id)?.stateCategory !== 'Completed')
      || !local || local.stage === 'done' || managedChildReason(local, items) || isLocked(child.id)) {
      deferred.push(child.id); continue;
    }
    return { id: child.id, deferred };
  }
  return { id: null, deferred };
}
