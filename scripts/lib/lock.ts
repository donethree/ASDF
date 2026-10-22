// Per-item locks (<item>/.lock) so overlapping do-next passes never work the same item.
import { closeSync, existsSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { itemPath } from './items.ts';
import { getConfig, withSettingsGuard } from './settings.ts';
import { fail, now, parseTime, prop, readJson, same, stamp, type Json } from './util.ts';
import { artifactPath, atomicJson } from './artifacts.ts';
import { readWorkerClaim, withItemGuard, writeWorkerClaim } from './workerLease.ts';

function lockPath(id: number): string {
  const path = itemPath(id);
  if (!path) fail('ASDF_ITEM_NOT_FOUND', String(id));
  return artifactPath(id, '.lock');
}

function staleMinutes(): number {
  let minutes: unknown;
  try {
    minutes = prop(getConfig(), 'lockStaleMinutes');
  } catch {
    // An unreadable config falls back to the default.
  }
  return minutes ? Number(minutes) : 90;
}

function readLock(path: string): Json {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

// A lock with no readable heartbeat (being written right now) falls back to the file's write time.
function isStale(lock: Json, path: string, at: Date): boolean {
  let since: Date | null;
  try {
    const heartbeat = prop(lock, 'heartbeatAt');
    since = heartbeat ? parseTime(heartbeat) : statSync(path).mtime;
  } catch {
    return true;
  }
  return since === null || (at.getTime() - since.getTime()) / 60000 > staleMinutes();
}

// Creates the lock file only if no other pass has one: the 'wx' open fails when the file exists.
function tryCreate(path: string, owner: string, at: Date): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch {
    return false;
  }
  try {
    const time = stamp(at);
    writeSync(fd, JSON.stringify({ owner, acquiredAt: time, heartbeatAt: time }));
  } finally {
    closeSync(fd);
  }
  return true;
}

export function lockItem(id: number, owner: string, at?: string | Date): Json {
  return withSettingsGuard(() => withItemGuard(id, () => acquire(id, owner, at)));
}

function acquire(id: number, owner: string, at?: string | Date): Json {
  const time = now(at);
  const path = lockPath(id);
  const claim = readWorkerClaim(id);
  if (claim && claim.owner !== owner) return { acquired: false, owner: claim.owner, tookOver: false };
  if (claim && !same(prop(readLock(path), 'owner'), owner)) fail('ASDF_LOCK_NOT_OWNER', 'worker claim and operation lock disagree');
  if (tryCreate(path, owner, time)) return { acquired: true, owner, tookOver: false };
  const lock = readLock(path);
  if (same(prop(lock, 'owner'), owner)) {
    heartbeat(id, owner, time);
    return { acquired: true, owner, tookOver: false };
  }
  if (isStale(lock, path, time)) {
    // Re-read right before deleting, to narrow the window where a fresh lock replaced the stale one.
    const again = readLock(path);
    if ((prop(again, 'heartbeatAt') ?? null) === (prop(lock, 'heartbeatAt') ?? null)) {
      try {
        rmSync(path, { force: true });
      } catch {
        // Another pass holds the file open; it isn't ours to take.
      }
      if (tryCreate(path, owner, time)) return { acquired: true, owner, tookOver: true };
    }
  }
  return { acquired: false, owner: prop(readLock(path), 'owner') ?? null, tookOver: false };
}

export function heartbeat(id: number, owner: string, at?: string | Date): true {
  return withItemGuard(id, () => {
    const path = lockPath(id);
    const lock = existsSync(path) ? readLock(path) : null;
    if (!same(prop(lock, 'owner'), owner)) fail('ASDF_LOCK_NOT_OWNER', `item ${id} is not locked by ${owner}`);
    const claim = readWorkerClaim(id);
    if (claim && claim.owner !== owner) fail('ASDF_LOCK_NOT_OWNER', 'worker claim belongs to another owner');
    lock.heartbeatAt = stamp(now(at));
    atomicJson(path, lock);
    if (claim) writeWorkerClaim(id, { ...claim, heartbeatAt: lock.heartbeatAt });
    return true;
  });
}

export function unlockItem(id: number, owner: string): Json {
  return withItemGuard(id, () => {
    const path = lockPath(id);
    const lock = existsSync(path) ? readLock(path) : null;
    if (!same(prop(lock, 'owner'), owner) || readWorkerClaim(id)) return { removed: false };
    rmSync(path, { force: true });
    return { removed: true };
  });
}

export function isLocked(id: number, at?: string | Date): boolean {
  if (readWorkerClaim(id)) return true;
  const path = lockPath(id);
  if (!existsSync(path)) return false;
  return !isStale(readLock(path), path, now(at));
}

export function assertItemOwner(id: number, owner: string, at?: string | Date): void {
  withItemGuard(id, () => {
    const path = lockPath(id);
    const lock = readLock(path);
    const claim = readWorkerClaim(id);
    if (!same(prop(lock, 'owner'), owner) || (claim ? claim.owner !== owner : isStale(lock, path, now(at)))) {
      fail('ASDF_LOCK_NOT_OWNER', `item ${id} is not held by ${owner}`);
    }
  });
}
