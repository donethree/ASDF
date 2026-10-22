import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { setItem, setItemStage } from '../scripts/lib/items.ts';
import { getSessionStatus, refreshSessionStatus } from '../scripts/lib/sessionStatus.ts';
import { runPath, sessionPath } from '../scripts/lib/sessions.ts';
import { runWorker } from '../scripts/lib/worker.ts';
import { writeWorkerClaim } from '../scripts/lib/workerLease.ts';
import { unlockItem } from '../scripts/lib/lock.ts';
import { runCli } from './helpers.ts';
import { fakeExecutable, sessionFixture } from './session-fixtures.ts';

describe('session observation', () => {
  let fixture: ReturnType<typeof sessionFixture>;
  beforeEach(() => { fixture = sessionFixture(false); });

  it('links waiting answers to HLD and preserves last sync on later stage changes', () => {
    setItem(42, { ado: { hldId: 43 } });
    setItemStage(42, 'awaiting-answers');
    const first = refreshSessionStatus(42, '2026-10-22T06:00:00Z');
    assert.equal(first.waiting?.targetUrl, 'https://dev.azure.com/contoso/Storage/_workitems/edit/43');
    assert.equal(first.lastSyncedAt, '2026-10-22T06:00:00Z');
    setItemStage(42, 'awaiting-approval');
    assert.equal(refreshSessionStatus(42).lastSyncedAt, first.lastSyncedAt);
    assert.match(readFileSync(sessionPath(42, 'status.md'), 'utf8'), /approval/);
  });

  it('uses repository identity and escaped URL segments for PR links', () => {
    setItem(42, { ado: { prId: 50 }, repo: { org: 'fabrikam', project: 'Shared Tools', name: 'A&B' } });
    setItemStage(42, 'pr-open');
    assert.equal(getSessionStatus(42).waiting?.targetUrl, 'https://dev.azure.com/fabrikam/Shared%20Tools/_git/A%26B/pullrequest/50');
  });

  for (const stage of ['tracked', 'awaiting-parent', 'awaiting-pbis', 'merging', 'blocked', 'paused']) {
    it(`explains ${stage} without inventing a PR`, () => {
      setItemStage(42, stage, 'reason');
      const result = getSessionStatus(42);
      assert.ok(result.waiting?.reason);
      assert.equal(Boolean(result.waiting?.targetUrl?.includes('pullrequest')), false);
    });
  }

  it('reads status without writing and leaves busy sync files untouched', () => {
    refreshSessionStatus(42);
    const before = readFileSync(sessionPath(42, 'status.json'), 'utf8');
    assert.equal(runCli('session-info', '-Id', '42').code, 0);
    assert.equal(readFileSync(sessionPath(42, 'status.json'), 'utf8'), before);
    const { request } = fixture;
    writeWorkerClaim(42, { schemaVersion: 1, itemId: 42, runId: request.runId, owner: request.owner, sessionId: request.sessionId,
      host: 'test', runnerPid: process.pid, childPid: null, phase: 'running', heartbeatAt: new Date().toISOString() });
    const signals = runPath(42, request.runId, 'signals.json');
    mkdirSync(dirname(signals), { recursive: true });
    writeFileSync(signals, JSON.stringify({ workItem: { assignedToMe: false } }));
    assert.equal(runCli('signals', '-Id', '42', '-File', signals).json.processed, false);
    assert.equal(readFileSync(sessionPath(42, 'status.json'), 'utf8'), before);
    assert.equal(runCli('stage', '-Id', '42', '-Stage', 'done').json.error, 'ASDF_LOCK_NOT_OWNER');
  });

  it('reports projection failure after applied workflow progress', () => {
    mkdirSync(sessionPath(42, 'status.md'));
    const result = runCli('stage', '-Id', '42', '-Stage', 'awaiting-answers');
    assert.equal(result.code, 1);
    assert.equal(result.json.error, 'ASDF_SESSION_STATUS_FAILED');
    assert.equal(result.json.operationApplied, true);
    assert.equal(runCli('item', '-Id', '42').json.stage, 'awaiting-answers');
  });

  it('keeps a good transcript when a later export is absent', async () => {
    unlockItem(42, fixture.request.owner);
    assert.equal((await runWorker({ id: 42, passId: 'a' }, fakeExecutable('worker'))).status, 'completed');
    const before = readFileSync(sessionPath(42, 'transcript.md'), 'utf8');
    setItemStage(42, 'answers-received');
    const next = await runWorker({ id: 42, passId: 'b' }, fakeExecutable('worker-no-export'));
    assert.equal(next.status, 'completed');
    assert.equal(next.observationError?.code, 'ASDF_SESSION_EXPORT_FAILED');
    assert.equal(readFileSync(sessionPath(42, 'transcript.md'), 'utf8'), before);
    assert.equal(getSessionStatus(42).stage, 'awaiting-approval');
  });
});
