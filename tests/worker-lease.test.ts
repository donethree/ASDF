import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { beforeEach, describe, it } from 'node:test';
import { itemPath, newItem, setItemStage } from '../scripts/lib/items.ts';
import { heartbeat, lockItem, unlockItem } from '../scripts/lib/lock.ts';
import { getQueueReport } from '../scripts/lib/queue.ts';
import { invokeSignals } from '../scripts/lib/signals.ts';
import { readWorkerClaim, removeWorkerClaim, withItemGuard, writeWorkerClaim, type WorkerClaim } from '../scripts/lib/workerLease.ts';
import { REPO, newContext } from './helpers.ts';

const START = new Date('2026-10-20T08:00:00Z');
const LATER = new Date('2026-10-20T12:00:00Z');
describe('worker ownership', () => {
  let owner: string;
  let claim: WorkerClaim;
  beforeEach(() => {
    newContext();
    for (const id of [42, 43]) {
      newItem({ id, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
      setItemStage(id, 'new');
    }
    owner = randomUUID();
    lockItem(42, owner, START);
    claim = { schemaVersion: 1, itemId: 42, owner, runId: owner, sessionId: randomUUID(), host: 'test',
      runnerPid: process.pid, childPid: null, phase: 'reserved', heartbeatAt: START.toISOString() };
  });

  it('keeps unfinished workers exclusive beyond stale lock age', () => {
    writeWorkerClaim(42, claim);
    assert.equal(lockItem(42, 'other', LATER).acquired, false);
    assert.equal(unlockItem(42, owner).removed, false);
    assert.deepEqual(getQueueReport(LATER).items.map(x => x.id), [43]);
    assert.equal(getQueueReport(LATER).deferred[0].id, 42);
    heartbeat(42, owner, LATER);
    assert.equal(readWorkerClaim(42)?.heartbeatAt, LATER.toISOString().replace('.000Z', 'Z'));
  });

  it('does not mutate a busy item during sync', () => {
    writeWorkerClaim(42, claim);
    const before = readFileSync(join(itemPath(42)!, 'state.json'), 'utf8');
    assert.equal(invokeSignals(42, { workItem: { assignedToMe: false } }, LATER).processed, false);
    assert.equal(readFileSync(join(itemPath(42)!, 'state.json'), 'utf8'), before);
  });

  it('permits only matching finalization and preserves other owners', () => {
    writeWorkerClaim(42, claim);
    assert.throws(() => removeWorkerClaim(42, owner, 'other'), { code: 'ASDF_LOCK_NOT_OWNER' });
    withItemGuard(42, () => {
      removeWorkerClaim(42, owner, owner);
      assert.equal(unlockItem(42, owner).removed, true);
    });
    assert.equal(readWorkerClaim(42), null);
    assert.equal(lockItem(42, 'new', LATER).acquired, true);
    assert.throws(() => heartbeat(42, owner, LATER), { code: 'ASDF_LOCK_NOT_OWNER' });
    assert.equal(unlockItem(42, owner).removed, false);
  });

  it('reports corrupt claims without discarding healthy queue items', () => {
    writeWorkerClaim(42, claim);
    writeFileSync(join(itemPath(42)!, 'session', 'active-run.json'), '{}');
    const queue = getQueueReport(LATER);
    assert.deepEqual(queue.items.map(x => x.id), [43]);
    assert.equal(queue.deferred[0].error?.code, 'ASDF_SESSION_STATE_INVALID');
    assert.throws(() => lockItem(42, 'other', LATER), { code: 'ASDF_SESSION_STATE_INVALID' });
  });

  it('reclaims a guard whose same-host holder was killed', async () => {
    const child = spawn(process.execPath, [join(REPO, 'tests', 'fixtures', 'hold-guard.ts')], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    try {
      const [output] = await once(child.stdout, 'data');
      assert.match(String(output), /holding/);
      child.kill('SIGKILL');
      await closed;
      assert.equal(lockItem(42, 'recovered', LATER).acquired, true);
    } finally { child.kill('SIGKILL'); }
  });
});
