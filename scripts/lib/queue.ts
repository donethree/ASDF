// The do-next work queue: actionable items, most-finished work first.
import { STAGE_PRIORITY, getItems, itemPath, managedChildReason } from './items.ts';
import { isLocked } from './lock.ts';
import { readWorkerClaim, workerNeedsRecovery } from './workerLease.ts';
import { isLiveReserved, readLiveWatch } from './liveWatch.ts';
import { AsdfError, now, type Json } from './util.ts';

function priorityOf(stage: unknown): number | undefined {
  const key = String(stage).toLowerCase();
  return Object.hasOwn(STAGE_PRIORITY, key) ? STAGE_PRIORITY[key] : undefined;
}

// Unlocked items at a stage with a priority, by priority, then the longest wait at that stage, then id.
export function getQueue(at?: string | Date): Json[] {
  const report = getQueueReport(at);
  const invalid = report.deferred.find((entry) => entry.error);
  if (invalid?.error) throw new AsdfError(invalid.error.code, invalid.error.message);
  return report.items;
}

export function getQueueReport(at?: string | Date): {
  items: Json[]; deferred: { id: number; reason: string; error?: { code: string; message: string } }[];
} {
  const time = now(at);
  const entries: { item: Json; entered: string }[] = [];
  const deferred: { id: number; reason: string; error?: { code: string; message: string } }[] = [];
  const items = getItems();
  for (const item of items) {
    if (managedChildReason(item, items)) continue;
    const priority = priorityOf(item.stage);
    if (priority === undefined) continue;
    try {
      if (isLocked(item.id, time)) {
        const claim = readWorkerClaim(item.id);
        deferred.push({ id: item.id, reason: claim && workerNeedsRecovery(claim)
          ? 'unfinished worker needs recovery; do not automatically relaunch'
          : isLiveReserved(readLiveWatch(item.id), time) ? 'interactive session is watching this item'
          : 'item operation or unfinished worker is held' });
        continue;
      }
    } catch (error) {
      if (!(error instanceof AsdfError)) throw error;
      deferred.push({ id: item.id, reason: 'ownership needs attention', error: { code: error.code, message: error.message } });
      continue;
    }
    item.priority = priority;
    item.path = itemPath(item.id);
    entries.push({ item, entered: String(item.stats?.stageEnteredAt?.[item.stage] ?? '') });
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  entries.sort((a, b) => a.item.priority - b.item.priority || compare(a.entered, b.entered) || Number(a.item.id) - Number(b.item.id));
  return { items: entries.map((entry) => entry.item), deferred };
}
