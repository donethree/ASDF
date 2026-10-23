import { artifactPath, atomicJson, optionalJson, uuid } from './artifacts.ts';
import { validateDesignTarget, type DesignTarget } from './approval.ts';
import { getItem } from './items.ts';
import { fail, isObject, now, same } from './util.ts';

export const LIVE_INTERVAL_SECONDS = 300;
export const LIVE_RESERVATION_SECONDS = 900;
export const LIVE_WAIT_STAGES = ['awaiting-answers', 'awaiting-approval', 'pr-open', 'merging'] as const;
export type LiveKey = { watchId: string; generation: number };
export type LiveWatch = {
  schemaVersion: 1; item: { id: number; org: string; project: string };
  threadId: string; rootItemId: number; watchId: string; generation: number;
  status: 'preparing' | 'armed' | 'checking' | 'working' | 'stopped';
  waitStage: typeof LIVE_WAIT_STAGES[number]; target: DesignTarget | null; prId: number | null;
  scheduleId: number | null; operationOwner: string | null;
  lastSuccessfulCheckAt: string | null; expiresAt: string;
};
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function parseLiveWatch(value: unknown, item: { id: number; org: string; project: string }): LiveWatch {
  const id = item.id;
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.item) || value.item.id !== id
    || !same(value.item.org, item.org) || !same(value.item.project, item.project)
    || !uuid(value.watchId) || !uuid(value.threadId) || !Number.isSafeInteger(value.generation) || value.generation < 1
    || !Number.isSafeInteger(value.rootItemId) || value.rootItemId < 1
    || !['preparing', 'armed', 'checking', 'working', 'stopped'].includes(value.status)
    || !LIVE_WAIT_STAGES.some(s => s === value.waitStage)
    || !(value.scheduleId === null || (Number.isSafeInteger(value.scheduleId) && value.scheduleId > 0))
    || !(value.prId === null || (Number.isSafeInteger(value.prId) && value.prId > 0))
    || !(value.operationOwner === null || (typeof value.operationOwner === 'string' && value.operationOwner))
    || !(value.lastSuccessfulCheckAt === null || time(value.lastSuccessfulCheckAt)) || !time(value.expiresAt)) {
    fail('ASDF_LIVE_INVALID', `invalid live watch for item ${id}`);
  }
  let target: DesignTarget | null;
  try { target = value.target === null ? null : validateDesignTarget(value.target); }
  catch { return fail('ASDF_LIVE_INVALID', `invalid watched design for item ${id}`); }
  return { schemaVersion: 1, item: { id, org: item.org, project: item.project }, threadId: value.threadId, rootItemId: value.rootItemId,
    watchId: value.watchId, generation: value.generation, status: value.status, waitStage: value.waitStage, target,
    prId: value.prId, scheduleId: value.scheduleId, operationOwner: value.operationOwner,
    lastSuccessfulCheckAt: value.lastSuccessfulCheckAt, expiresAt: value.expiresAt };
}
export function readLiveWatch(id: number): LiveWatch | null {
  let value: unknown;
  try { value = optionalJson(artifactPath(id, 'live-watch.json')); }
  catch { return fail('ASDF_LIVE_INVALID', `unreadable live watch for item ${id}`); }
  return value === null ? null : parseLiveWatch(value, getItem(id));
}
export function writeLiveWatch(id: number, value: LiveWatch): void {
  atomicJson(artifactPath(id, 'live-watch.json'), parseLiveWatch(value, getItem(id)));
}
export function isLiveReserved(watch: LiveWatch | null, at?: Date): boolean {
  return Boolean(watch && ['preparing', 'armed', 'checking'].includes(watch.status) && Date.parse(watch.expiresAt) > now(at).getTime());
}
export function validateLiveKey(id: number, key: LiveKey): LiveWatch {
  const watch = readLiveWatch(id);
  if (!watch || watch.watchId !== key.watchId || watch.generation !== key.generation || watch.status === 'stopped') {
    fail('ASDF_LIVE_STALE', `live watch for item ${id} changed or stopped`);
  }
  return watch;
}
export function assertLiveMutation(id: number, owner?: string): void {
  const watch = readLiveWatch(id);
  if (!watch) return;
  const lock = optionalJson(artifactPath(id, '.lock'));
  const annotated = isObject(lock) && lock.liveWatchId === watch.watchId && lock.liveGeneration === watch.generation;
  if (isLiveReserved(watch) || annotated) {
    if (!owner || !annotated || lock.owner !== owner) fail('ASDF_LOCK_NOT_OWNER', `item ${id} belongs to a live operation; supply its current Owner`);
  }
}
