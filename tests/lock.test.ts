import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { beforeEach, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { newItem } from '../scripts/lib/items.ts';
import { heartbeat, lockItem, unlockItem } from '../scripts/lib/lock.ts';
import { CLI, newContext } from './helpers.ts';

const START = new Date('2026-10-20T08:00:00Z');
const minutesLater = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

describe('locks', () => {
  beforeEach(() => {
    newContext();
    newItem({ org: 'contoso', project: 'Storage', id: 1, kind: 'parent', type: 'Product Backlog Item', title: 'A' });
  });

  it('acquires a free lock, and re-acquires its own', () => {
    assert.equal(lockItem(1, 'a', START).acquired, true);
    assert.equal(lockItem(1, 'a', START).acquired, true);
  });

  it('refuses a fresh lock held by another pass', () => {
    lockItem(1, 'a', START);
    assert.deepEqual(lockItem(1, 'b', minutesLater(89)), { acquired: false, owner: 'a', tookOver: false });
  });

  it('takes over a lock after 90 minutes without a heartbeat', () => {
    lockItem(1, 'a', START);
    assert.deepEqual(lockItem(1, 'b', minutesLater(91)), { acquired: true, owner: 'b', tookOver: true });
  });

  it('keeps a lock fresh with heartbeats', () => {
    lockItem(1, 'a', START);
    heartbeat(1, 'a', minutesLater(60));
    assert.equal(lockItem(1, 'b', minutesLater(120)).acquired, false);
  });

  it('lets only the owner heartbeat or unlock', () => {
    lockItem(1, 'a', START);
    assert.throws(() => heartbeat(1, 'b'), { code: 'ASDF_LOCK_NOT_OWNER' });
    assert.equal(unlockItem(1, 'b').removed, false);
    assert.equal(unlockItem(1, 'a').removed, true);
  });

  it('lets exactly one of two racing passes win', async () => {
    const lock = (owner: string) => promisify(execFile)(process.execPath, [CLI, 'lock', '-Id', '1', '-Owner', owner], { env: process.env });
    const results = await Promise.all([lock('pass-1'), lock('pass-2')]);
    const winners = results.filter(({ stdout }) => JSON.parse(stdout).acquired);
    assert.equal(winners.length, 1);
  });
});
