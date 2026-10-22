// ADO signals -> stage transitions. Pure rules over a signals object that do-next gathers through the ADO MCP server.
import { getItem, setItem, setItemStage } from './items.ts';
import { heartbeat, isLocked } from './lock.ts';
import { isFalse, isTrue, now, oneOf, parseTime, prop, same, stamp, toList, type Json } from './util.ts';

const ACTIVE = ['InProgress', 'Resolved'];
const ACTIVE_PARENTLESS_TASK = ['Proposed', 'InProgress', 'Resolved'];

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', ndash: '\u2013', mdash: '\u2014',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D', hellip: '\u2026', bull: '\u2022',
  middot: '\u00B7', laquo: '\u00AB', raquo: '\u00BB', copy: '\u00A9', reg: '\u00AE', trade: '\u2122', times: '\u00D7',
};

// HTML entities as text: named ones from the table, and every numeric one. Unknown entities stay as they are.
function decodeEntities(text: string): string {
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (entity, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : entity;
  });
}

// ADO comment HTML as one line of text. @mentions are dropped, so "@Ana approved" reads as "approved".
export function plainText(html: unknown): string {
  if (!html) return '';
  let text = String(html).replace(/<a\b[^>]*data-vss-mention[^>]*>.*?<\/a>/gis, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  return decodeEntities(text).replace(/[\s\u00A0]+/g, ' ').trim();
}

export function isMarkedComment(text: unknown): boolean {
  return plainText(text).startsWith('[ASDF]');
}

export function isApprovalText(text: unknown): boolean {
  return !isMarkedComment(text) && /^approved\b/i.test(plainText(text));
}

function createdAt(comment: Json): number {
  return parseTime(prop(comment, 'createdAt'))?.getTime() ?? Number.NEGATIVE_INFINITY;
}

// Human (non-ASDF) comments newer than `after`, oldest first. A missing `after` counts every human comment.
function humanCommentsAfter(comments: unknown, after: unknown): Json[] {
  const afterTime = parseTime(after)?.getTime() ?? null;
  return toList(comments)
    .filter((c) => !isMarkedComment(prop(c, 'text')) && (afterTime === null || createdAt(c) > afterTime))
    .sort((a, b) => createdAt(a) - createdAt(b));
}

// Is the item's governing work item active? Null when this pass didn't check.
function governing(state: Json, signals: Json): { active: boolean; reason: string } | null {
  const workItem = prop(signals, 'workItem');
  if (workItem === null || workItem === undefined) return null;
  if (isFalse(prop(workItem, 'assignedToMe'))) return { active: false, reason: 'not assigned' };
  const isTask = same(prop(state, 'kind'), 'task');
  let category: unknown;
  let activeSet = ACTIVE;
  if (isTask && prop(workItem, 'parentId')) {
    const own = prop(workItem, 'stateCategory');
    if (oneOf(own, ['Completed', 'Removed'])) return { active: false, reason: String(own) };
    category = prop(prop(signals, 'parent'), 'stateCategory');
  } else {
    category = prop(workItem, 'stateCategory');
    if (isTask) activeSet = ACTIVE_PARENTLESS_TASK;
  }
  if (!category) return null;
  return { active: oneOf(category, activeSet), reason: String(category) };
}

export interface Transition {
  stage: string | null;
  reason: string | null;
  patch: Json;
}

const go = (stage: string, reason: string, patch: Json = {}): Transition => ({ stage, reason, patch });
const none = (): Transition => ({ stage: null, reason: null, patch: {} });

export function getTransition(state: Json, signals: Json, at?: string | Date): Transition {
  const time = now(at);
  const stage = String(prop(state, 'stage') ?? '');
  const resume = prop(state, 'resumeStage') || 'tracked';
  const stateHld = prop(state, 'hld');
  const hldSignal = prop(signals, 'hld');
  const pr = prop(signals, 'pr');

  // 1. Finished items never move, nor does a Feature whose close-out is due.
  if (oneOf(stage, ['done', 'merged', 'pbis-done'])) return none();

  // A completed PR is merged, even if the governing item was closed or reassigned in the meantime, including after a pause.
  const prStages = ['pr-open', 'pr-feedback', 'pr-ready', 'merging'];
  const prStage = Boolean(prop(prop(state, 'ado'), 'prId')) || oneOf(stage, prStages)
    || (same(stage, 'paused') && oneOf(resume, prStages));
  const closeOutBlocked = same(stage, 'blocked') && same(resume, 'merged');
  if (prStage && !closeOutBlocked && same(prop(pr, 'status'), 'completed')) return go('merged', 'PR completed');

  // 2-4. Governing item: pause, resume, pick up.
  const gov = closeOutBlocked ? null : governing(state, signals);
  if (gov && !gov.active && !oneOf(stage, ['tracked', 'awaiting-parent', 'paused'])) return go('paused', gov.reason);
  if (same(stage, 'paused')) return gov?.active ? go(resume, 'resumed') : none();
  if (same(stage, 'tracked')) return gov?.active ? go('new', 'picked up') : none();
  if (prStage && stage !== 'blocked' && same(prop(pr, 'status'), 'abandoned')) return go('blocked', 'PR abandoned');

  // 5. A complex Task got its parent.
  if (same(stage, 'awaiting-parent')) {
    const workItem = prop(signals, 'workItem');
    if (isFalse(prop(workItem, 'assignedToMe'))) return go('paused', 'not assigned');
    const own = prop(workItem, 'stateCategory');
    if (oneOf(own, ['Completed', 'Removed'])) return go('paused', String(own));
    if (!prop(prop(signals, 'workItem'), 'parentId')) return none();
    if (oneOf(prop(prop(signals, 'parent'), 'stateCategory'), ACTIVE)) return go('new', 'parented');
    return go('tracked', 'parented; parent not active');
  }

  // 6. Answers to an open round.
  if (same(stage, 'awaiting-answers')) {
    const answers = humanCommentsAfter(prop(hldSignal, 'comments'), prop(stateHld, 'roundPostedAt'));
    return answers.length > 0 ? go('answers-received', 'answers posted') : none();
  }

  // 7. Approval: the HLD task moved to Completed after the request, or the latest human comment after the request starts with "approved".
  if (same(stage, 'awaiting-approval')) {
    if (same(prop(hldSignal, 'stateCategory'), 'Completed')) {
      const requested = parseTime(prop(stateHld, 'approvalRequestedAt'));
      const changed = parseTime(prop(hldSignal, 'stateChangedAt'));
      if (requested === null || (changed !== null && changed.getTime() >= requested.getTime())) {
        return go('approved', 'HLD task completed', { hld: { approvedBy: 'state', approvedAt: stamp(time) } });
      }
    }
    const after = humanCommentsAfter(prop(hldSignal, 'comments'), prop(stateHld, 'approvalRequestedAt'));
    if (after.length === 0) return none();
    const latest = after[after.length - 1];
    if (isApprovalText(prop(latest, 'text'))) {
      const approvedAt = stamp(parseTime(prop(latest, 'createdAt')) ?? time);
      return go('approved', 'approved in a comment', { hld: { approvedBy: prop(latest, 'author') ?? null, approvedAt } });
    }
    return go('answers-received', 'changes requested');
  }

  // 8. A reopened design stops build work, up to the merge, and a reopened breakdown stops a Feature waiting on its PBIs.
  // A PR already set to auto-complete is left to finish.
  if (oneOf(stage, ['approved', 'implementing', 'self-review', 'pr-open', 'pr-feedback', 'pr-ready', 'awaiting-pbis'])) {
    if (prop(stateHld, 'closedAt') && oneOf(prop(hldSignal, 'stateCategory'), ['Proposed', 'InProgress'])) {
      const reason = same(prop(state, 'kind'), 'feature') ? 'breakdown reopened' : 'HLD reopened';
      return go('answers-received', reason, { hld: { closedAt: null } });
    }
  }

  // A Feature whose PBIs are all finished is due for its close-out.
  if (same(stage, 'awaiting-pbis')) {
    const pbis = toList(prop(signals, 'pbis'));
    const finished = pbis.length > 0 && pbis.every((pbi) => oneOf(prop(pbi, 'stateCategory'), ['Completed', 'Removed']));
    return finished ? go('pbis-done', 'every PBI finished') : none();
  }

  // 9. Pull request state.
  if (oneOf(stage, ['pr-open', 'merging'])) {
    if (pr === null || pr === undefined) return none();
    const status = prop(pr, 'status');
    if (same(status, 'completed')) return go('merged', 'PR completed');
    if (same(status, 'abandoned')) return go('blocked', 'PR abandoned');
    const activeThreads = toList(prop(pr, 'threads')).filter((t) => same(prop(t, 'status'), 'active'));
    if (activeThreads.some((t) => !isTrue(prop(t, 'lastCommentIsAsdf')))) return go('pr-feedback', 'new review comments');
    if (same(prop(pr, 'build'), 'failed')) return go('pr-feedback', 'build failed');
    if (isTrue(prop(pr, 'mergeConflicts'))) return go('pr-feedback', 'merge conflicts');
    if (same(stage, 'pr-open') && isTrue(prop(pr, 'approved')) && oneOf(prop(pr, 'build'), ['succeeded', 'none']) && activeThreads.length === 0) {
      return go('pr-ready', 'approved and green');
    }
    return none();
  }

  // 10. A person replied to a blocker. Without a recorded blocker comment time, nothing counts as a reply.
  if (same(stage, 'blocked')) {
    const since = prop(prop(state, 'blocker'), 'commentAt');
    if (since && humanCommentsAfter(prop(prop(signals, 'blocker'), 'comments'), since).length > 0) return go(resume, 'unblocked');
    return none();
  }

  return none();
}

export function invokeSignals(id: number, signals: Json, at?: string | Date, owner?: string): Json {
  const state = getItem(id);
  if (owner !== undefined) heartbeat(id, owner, at);
  else if (isLocked(id, at)) return { from: state.stage, to: state.stage, reason: 'locked by another pass', processed: false };
  const transition = getTransition(state, signals, at);
  if (transition.stage) {
    if (Object.keys(transition.patch).length > 0) setItem(id, transition.patch);
    setItemStage(id, transition.stage, transition.reason ?? undefined, null, at);
  }
  return { from: state.stage, to: transition.stage ?? state.stage, reason: transition.reason, processed: true, ...readyIfWaiting(state, transition, signals) };
}

// A Feature waiting on its PBIs also reports which of them a person can start now.
function readyIfWaiting(state: Json, transition: Transition, signals: Json): Json {
  const to = transition.stage ?? state.stage;
  return same(prop(state, 'kind'), 'feature') && same(to, 'awaiting-pbis') ? { ready: readyPbis(state, signals) } : {};
}

// The Feature's PBIs a person can start now: still Proposed, with every PBI they wait for Completed.
export function readyPbis(state: Json, signals: Json): number[] {
  const categories = new Map<string, unknown>();
  for (const pbi of toList(prop(signals, 'pbis'))) categories.set(String(prop(pbi, 'id')), prop(pbi, 'stateCategory'));
  const categoryOf = (id: unknown) => categories.get(String(id));
  return toList(prop(prop(state, 'ado'), 'pbis'))
    .filter((pbi) => same(categoryOf(prop(pbi, 'id')), 'Proposed'))
    .filter((pbi) => toList(prop(pbi, 'waitsFor')).every((id) => same(categoryOf(id), 'Completed')))
    .map((pbi) => Number(prop(pbi, 'id')));
}
