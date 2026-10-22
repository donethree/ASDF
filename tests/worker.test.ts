import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, it } from 'node:test';
import { getItem, newItem, setItemStage } from '../scripts/lib/items.ts';
import { getQueueReport } from '../scripts/lib/queue.ts';
import { runWorker } from '../scripts/lib/worker.ts';
import { completeWorker, listRuns, readBinding, recoverSession, runPath, sessionPath } from '../scripts/lib/sessions.ts';
import { readWorkerClaim } from '../scripts/lib/workerLease.ts';
import { getConfig, setConfig } from '../scripts/lib/settings.ts';
import { getSessionStatus } from '../scripts/lib/sessionStatus.ts';
import { CLI, REPO, newContext, newFolder, runCli } from './helpers.ts';
import { fakeExecutable } from './session-fixtures.ts';

describe('persistent item runner', () => {
  beforeEach(() => {
    newContext();
    delete process.env.ASDF_WORKER_REQUEST;
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Export' });
    setItemStage(42, 'new');
  });

  it('resumes a stable conversation with new ownership across runs', async () => {
    const first = await runWorker({ id: 42, passId: 'pass-a' }, fakeExecutable('worker'));
    assert.equal(first.status, 'completed', JSON.stringify(first));
    assert.equal(first.toStage, 'awaiting-answers');
    setItemStage(42, 'answers-received');
    const second = await runWorker({ id: 42, passId: 'pass-b' }, fakeExecutable('worker'));
    assert.equal(second.status, 'completed', JSON.stringify(second));
    assert.equal(second.sessionId, first.sessionId);
    assert.notEqual(second.runId, first.runId);
    assert.equal(second.toStage, 'awaiting-approval');
    assert.equal(readWorkerClaim(42), null);
    const transcript = JSON.parse(readFileSync(sessionPath(42, 'transcript.md'), 'utf8'));
    assert.ok(transcript.args.includes('--resume'));
    assert.equal(transcript.args.includes('--session-id'), false);
  });

  it('defers competing workers without a second CLI launch', async () => {
    const first = runWorker({ id: 42, passId: 'pass-a' }, fakeExecutable('worker-hold'));
    const second = await runWorker({ id: 42, passId: 'pass-b' }, fakeExecutable('worker'));
    assert.equal(second.status, 'deferred');
    assert.equal((await first).status, 'completed');
    assert.equal(listRuns(42).length, 1);
  });

  it('does not confuse a zero exit without acknowledgement with finished work', async () => {
    const result = await runWorker({ id: 42, passId: 'a' }, fakeExecutable('worker-incomplete'));
    assert.equal(result.status, 'incomplete');
    assert.equal(getItem(42).stage, 'awaiting-answers');
    assert.equal(readBinding(42)?.provisioning, 'confirmed');
    assert.equal(readWorkerClaim(42), null);
  });

  it('keeps infrastructure failures out of workflow stages', async () => {
    const result = await runWorker({ id: 42, passId: 'a' }, fakeExecutable('worker-infra'));
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'ASDF_WORKER_MCP_UNAVAILABLE');
    assert.equal(getItem(42).stage, 'new');
  });

  it('retains unresolved ownership for unknown termination', async () => {
    const pending = runWorker({ id: 42, passId: 'a' }, fakeExecutable('worker-hold'));
    process.emit('SIGTERM');
    const result = await pending;
    assert.equal(result.status, 'recovery-needed');
    assert.equal(readWorkerClaim(42)?.phase, 'recovery-needed');
    assert.equal(getQueueReport().items.length, 0);
    assert.throws(() => recoverSession(42, result.runId!, 'retry', 'investigated'), { code: 'ASDF_SESSION_RECOVERY_REQUIRED' });
  });

  it('rejects stale acknowledgements without changing binding or workflow', async () => {
    const result = await runWorker({ id: 42, passId: 'a' }, fakeExecutable('worker'));
    const before = readFileSync(sessionPath(42, 'binding.json'), 'utf8');
    assert.throws(() => completeWorker(42, result.runId!, randomUUID(), { sessionId: result.sessionId, outcome: 'waiting', summary: 'fake' }));
    assert.equal(readFileSync(sessionPath(42, 'binding.json'), 'utf8'), before);
    assert.equal(getItem(42).stage, 'awaiting-answers');
  });

  it('does not dispatch waiting items or managed children', async () => {
    setItemStage(42, 'awaiting-answers');
    assert.equal((await runWorker({ id: 42, passId: 'a' }, fakeExecutable())).status, 'deferred');
    assert.equal(readBinding(42), null);
    assert.equal(runCli('queue-report').code, 0);
  });

  it('rejects nested worker dispatch before any allocation', async () => {
    process.env.ASDF_WORKER_REQUEST = 'parent request';
    try {
      const result = await runWorker({ id: 42, passId: 'a' }, fakeExecutable());
      assert.equal(result.error?.code, 'ASDF_WORKER_RECURSION');
      assert.equal(readBinding(42), null);
    } finally { delete process.env.ASDF_WORKER_REQUEST; }
  });

  it('allows one winner across independent runner processes', async () => {
    const invoke = (pass: string) => promisify(execFile)(process.execPath, [join(REPO, 'tests', 'fixtures', 'run-worker.ts'), pass], { env: process.env });
    const values = await Promise.all([invoke('a'), invoke('b')]);
    const results = values.map(v => JSON.parse(v.stdout));
    assert.equal(results.filter(r => r.status === 'completed').length, 1, JSON.stringify(results));
    assert.equal(results.filter(r => r.status === 'deferred').length, 1, JSON.stringify(results));
    assert.equal(listRuns(42).length, 1);
  });

  it('requires exact resume after a closed failed session and records explicit replacement', async () => {
    const first = await runWorker({ id: 42, passId: 'a' }, fakeExecutable('nonzero'));
    assert.equal(first.status, 'failed');
    const replaced = recoverSession(42, first.runId!, 'replace', 'local history was explicitly retired');
    assert.notEqual(replaced.sessionId, first.sessionId);
    assert.equal(replaced.previous[0].sessionId, first.sessionId);
    assert.equal(listRuns(42).length, 1);
    const next = await runWorker({ id: 42, passId: 'b' }, fakeExecutable('worker'));
    assert.equal(next.status, 'completed');
    assert.equal(next.sessionId, replaced.sessionId);
  });

  it('does not dispatch an already-tracked child newly owned by a parent', async () => {
    newItem({ id: 43, org: 'contoso', project: 'Storage', kind: 'task', type: 'Task', title: 'Code change' });
    setItemStage(43, 'new');
    const file = join(newFolder(), 'child-patch.json');
    writeFileSync(file, JSON.stringify({ ado: { implIds: [43] } }));
    assert.equal(runCli('item-set', '-Id', '42', '-File', file).code, 0);
    assert.equal((await runWorker({ id: 43, passId: 'a' }, fakeExecutable())).status, 'deferred');
    assert.equal(readBinding(43), null);
  });

  it('refuses obsolete request paths even for ordinary CLI mutations', async () => {
    const first = await runWorker({ id: 42, passId: 'a' }, fakeExecutable('worker'));
    const result = await promisify(execFile)(process.execPath, [CLI, 'stage', '-Id', '42', '-Stage', 'done'], {
      env: { ...process.env, ASDF_WORKER_REQUEST: runPath(42, first.runId!, 'request.json') },
    }).then(r => ({ code: 0, stdout: r.stdout }), e => ({ code: e.code, stdout: e.stdout }));
    assert.notEqual(result.code, 0);
    assert.match(JSON.parse(result.stdout).error, /LOCK_NOT_OWNER|SESSION_STATE_INVALID/);
    assert.equal(getItem(42).stage, 'awaiting-answers');
  });

  it('releases a CLI that exited normally with stderr and no result', async () => {
    const result = await runWorker({ id: 42, passId: 'a' }, fakeExecutable('no-terminal'));
    assert.equal(result.status, 'failed');
    assert.equal(readWorkerClaim(42), null);
    const next = await runWorker({ id: 42, passId: 'b' }, fakeExecutable('worker'));
    assert.equal(next.sessionId, result.sessionId);
    assert.equal(next.status, 'completed');
    const transcript = JSON.parse(readFileSync(sessionPath(42, 'transcript.md'), 'utf8'));
    assert.ok(transcript.args.includes('--resume'));
  });

  it('recovers a killed reservation only after explicit stopped-process confirmation', async () => {
    const child = spawn(process.execPath, [join(REPO, 'tests', 'fixtures', 'hold-run.ts')], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    try {
      const [chunk] = await once(child.stdout, 'data');
      const runId = String(chunk).trim();
      const sessionId = readBinding(42)!.sessionId;
      child.kill('SIGKILL');
      await closed;
      assert.equal(getSessionStatus(42).error?.code, 'ASDF_SESSION_RECOVERY_REQUIRED');
      assert.match(getQueueReport().deferred[0].reason, /recovery/);
      assert.throws(() => recoverSession(42, runId, 'retry', 'stopped'), { code: 'ASDF_SESSION_RECOVERY_REQUIRED' });
      assert.equal(recoverSession(42, runId, 'retry', 'Operator verified the test process has no surviving descendants', true).sessionId, sessionId);
      assert.equal(readWorkerClaim(42), null);
      const next = await runWorker({ id: 42, passId: 'resume' }, fakeExecutable('worker'));
      assert.equal(next.sessionId, sessionId);
      assert.equal(next.status, 'completed');
      const transcript = JSON.parse(readFileSync(sessionPath(42, 'transcript.md'), 'utf8'));
      assert.ok(transcript.args.includes('--resume'));
    } finally { child.kill('SIGKILL'); }
  });

  it('does not kill a healthy worker on transient heartbeat guard contention', async () => {
    setConfig({ ...getConfig(), lockStaleMinutes: 0.03 });
    const pending = runWorker({ id: 42, passId: 'a' }, fakeExecutable('worker-wait'));
    const guard = spawn(process.execPath, [join(REPO, 'tests', 'fixtures', 'hold-guard.ts'), '4000'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(guard, 'close');
    await closed;
    const result = await pending;
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.equal(readWorkerClaim(42), null);
  });

  it('records a pre-spawn capture failure as not-started and permits a later attempt', async () => {
    const first = await runWorker({ id: 42, passId: 'a' }, fakeExecutable('fail-capture'));
    assert.equal(first.status, 'failed');
    assert.equal(listRuns(42)[0].termination, 'not-started');
    assert.equal(readWorkerClaim(42), null);
    const next = await runWorker({ id: 42, passId: 'b' }, fakeExecutable('worker'));
    assert.equal(next.status, 'completed');
    assert.equal(next.sessionId, first.sessionId);
    assert.equal(listRuns(42)[0].cliMode, 'create');
  });
});
