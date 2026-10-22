import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { hostname } from 'node:os';
import { describe, it, mock } from 'node:test';
import { recordAutomationEvent } from '../scripts/lib/automationLog.ts';
import { runCli } from '../scripts/lib/cli.ts';
import { writeRun, runPath } from '../scripts/lib/sessions.ts';
import { writeWorkerClaim } from '../scripts/lib/workerLease.ts';
import { setItemStage } from '../scripts/lib/items.ts';
import { sessionFixture } from './session-fixtures.ts';
import { newContext, newFolder, REPO, uninitialized } from './helpers.ts';

const NOW = new Date('2026-10-22T12:00:00Z');
const idle = { passId: 'pass-a', action: 'pass-finished', outcome: 'no-actionable-work' };
const filename = 'automation-2026-10-22.log';

describe('automation decision log', () => {
  it('appends one compact plain-text line and rotates by UTC day', () => {
    const ctx = newContext();
    const first = recordAutomationEvent(idle, NOW);
    assert.deepEqual(first, { written: true, path: join(realpathSync.native(ctx.context), filename), warnings: [] });
    assert.equal(readFileSync(first.path!, 'utf8'),
      '2026-10-22T12:00:00.000Z pass=pass-a action=pass-finished outcome=no-actionable-work\n');
    recordAutomationEvent({ ...idle, passId: 'pass-b' }, NOW);
    assert.equal(readFileSync(first.path!, 'utf8').trimEnd().split('\n').length, 2);
    const next = recordAutomationEvent(idle, new Date('2026-10-22T17:00:00-07:00'));
    assert.equal(next.path, join(realpathSync.native(ctx.context), 'automation-2026-10-23.log'));
    assert.ok(existsSync(first.path!));
  });

  it('quotes field values without turning reasons into extra lines', () => {
    newContext();
    const result = recordAutomationEvent({ passId: 'pass-a', action: 'item-failed', itemId: 42,
      org: 'contoso', project: 'Shared Tools', reason: 'Blocked "review"\nawaiting retry', errorCode: 'BUILD_FAILED' }, NOW);
    const text = readFileSync(result.path!, 'utf8');
    assert.ok(text.includes('project="Shared Tools"'));
    assert.ok(text.includes('reason="Blocked \\"review\\"\\nawaiting retry"'));
    assert.equal(text.trimEnd().split('\n').length, 1);
  });

  it('rejects unsupported payloads and invalid events before any log changes', () => {
    const ctx = newContext();
    const cases = [
      { ...idle, prompt: 'do not log this' }, { ...idle, sessionId: 'secret-session' },
      { ...idle, action: 'session-started' }, { ...idle, passId: '../escape' },
      { ...idle, reason: 'x'.repeat(241) }, { ...idle, action: 'item-selected' },
      { ...idle, action: 'item-selected', itemId: 0 },
      { ...idle, stage: 'unknown' },
      { passId: 'a', action: 'state-changed', itemId: 42, from: 'new', to: 'new' },
      { passId: 'a', action: 'stage-finished', itemId: 42 },
    ];
    for (const event of cases) assert.throws(() => recordAutomationEvent(event, NOW), { code: 'ASDF_BAD_ARGUMENT' });
    assert.equal(readdirSync(ctx.context).some(p => p.startsWith('automation-')), false);
  });

  it('prunes only complete expired days and leaves unrelated entries alone', () => {
    const ctx = newContext();
    const create = (name: string) => writeFileSync(join(ctx.context, name), 'kept unless expired');
    for (const name of ['automation-2026-10-15.log', 'automation-2026-10-16.log', 'automation-2026-10-17.log',
      'automation-2026-10-21.log', 'automation-2026-02-30.log', 'automation-2026-01-01.log.backup', 'notes.log']) create(name);
    mkdirSync(join(ctx.context, 'automation-2026-10-14.log'));
    const outside = newFolder('outside');
    symlinkSync(outside, join(ctx.context, 'automation-2026-10-13.log'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(recordAutomationEvent(idle, NOW).written, true);
    for (const day of ['15', '16']) assert.equal(existsSync(join(ctx.context, `automation-2026-10-${day}.log`)), false);
    for (const name of ['automation-2026-10-17.log', 'automation-2026-10-21.log', 'automation-2026-02-30.log',
      'automation-2026-01-01.log.backup', 'notes.log', 'automation-2026-10-14.log', 'automation-2026-10-13.log']) {
      assert.ok(existsSync(join(ctx.context, name)), name);
    }
  });

  it('handles the exact five-day midnight boundary conservatively', () => {
    const ctx = newContext();
    const older = join(ctx.context, 'automation-2026-10-16.log');
    const recent = join(ctx.context, 'automation-2026-10-17.log');
    writeFileSync(older, 'older'); writeFileSync(recent, 'recent');
    recordAutomationEvent(idle, new Date('2026-10-22T00:00:00Z'));
    assert.equal(existsSync(older), false);
    assert.equal(existsSync(recent), true);
  });

  it('does not initialize or recreate a missing context', () => {
    uninitialized();
    assert.equal(recordAutomationEvent(idle, NOW).written, false);
    const ctx = newContext();
    const missing = join(newFolder(), 'not-created');
    writeFileSync(ctx.settings, JSON.stringify({ schemaVersion: 1, contextPath: missing }));
    assert.equal(recordAutomationEvent(idle, NOW).written, false);
    assert.equal(existsSync(missing), false);
  });

  it('refuses a linked log or guard without touching its target', () => {
    for (const name of [filename, '.automation-log-guard']) {
      const ctx = newContext();
      const outside = newFolder('outside');
      symlinkSync(outside, join(ctx.context, name), process.platform === 'win32' ? 'junction' : 'dir');
      const result = recordAutomationEvent(idle, NOW);
      assert.equal(result.written, false);
      assert.ok(result.warnings.length);
      assert.deepEqual(readdirSync(outside), []);
    }
  });

  it('still appends when expired-file cleanup fails and reports that failure', () => {
    const ctx = newContext();
    const old = join(realpathSync.native(ctx.context), 'automation-2026-10-16.log');
    writeFileSync(old, 'keep on failure');
    const original = fs.unlinkSync;
    const replacement = mock.method(fs, 'unlinkSync', (path: Parameters<typeof fs.unlinkSync>[0]) => {
      if (String(path) === old) throw Object.assign(new Error('cleanup denied'), { code: 'EPERM' });
      return original(path);
    });
    syncBuiltinESMExports();
    try {
      const result = recordAutomationEvent(idle, NOW);
      assert.equal(result.written, true);
      assert.equal(result.warnings[0].code, 'ASDF_AUTOMATION_LOG_PRUNE_FAILED');
      assert.ok(existsSync(old));
      assert.ok(readFileSync(result.path!, 'utf8').includes('no-actionable-work'));
    } finally { replacement.mock.restore(); syncBuiltinESMExports(); }
  });

  it('reports append failure without changing configuration or workflow', () => {
    const ctx = newContext();
    const before = readFileSync(join(ctx.context, 'asdf.config.json'), 'utf8');
    const replacement = mock.method(fs, 'appendFileSync', () => { throw Object.assign(new Error('append denied'), { code: 'EACCES' }); });
    syncBuiltinESMExports();
    try {
      const result = recordAutomationEvent(idle, NOW);
      assert.equal(result.written, false);
      assert.equal(result.warnings[0].code, 'ASDF_AUTOMATION_LOG_APPEND_FAILED');
      assert.equal(readFileSync(join(ctx.context, 'asdf.config.json'), 'utf8'), before);
    } finally { replacement.mock.restore(); syncBuiltinESMExports(); }
  });

  it('serializes independent writers into complete lines', async () => {
    const ctx = newContext();
    const fixture = join(REPO, 'tests', 'fixtures', 'append-automation-log.ts');
    const outputs = await Promise.all(['a', 'b', 'c'].map(id => promisify(execFile)(process.execPath, [fixture, id], { env: process.env })));
    for (const output of outputs) assert.equal(JSON.parse(output.stdout).written, true);
    const lines = readFileSync(join(ctx.context, filename), 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 9);
    assert.equal(new Set(lines.map(l => /pass=([^ ]+)/.exec(l)?.[1])).size, 9);
    assert.ok(lines.every(l => l.endsWith('action=pass-finished outcome=no-actionable-work')));
  });

  it('bounds UTF-8 bytes and escapes Unicode line separators', () => {
    const ctx = newContext();
    assert.throws(() => recordAutomationEvent({ ...idle, org: '\u754c'.repeat(200),
      project: '\u754c'.repeat(200), team: '\u754c'.repeat(200), reason: '\u754c'.repeat(240) }, NOW), { code: 'ASDF_BAD_ARGUMENT' });
    assert.equal(readdirSync(ctx.context).some(p => p.startsWith('automation-')), false);
    const result = recordAutomationEvent({ ...idle, reason: 'one\u2028two\u2029three' }, NOW);
    const content = readFileSync(result.path!, 'utf8');
    assert.ok(content.includes('one\\u2028two\\u2029three'));
    assert.equal(content.trimEnd().split(/[\r\n\u2028\u2029]/).length, 1);
  });

  it('keeps CLI success truthful when append succeeds but cleanup warns', () => {
    const ctx = newContext();
    const old = join(realpathSync.native(ctx.context), 'automation-2000-01-01.log');
    writeFileSync(old, 'old');
    const original = fs.unlinkSync;
    const replacement = mock.method(fs, 'unlinkSync', (path: Parameters<typeof fs.unlinkSync>[0]) => {
      if (String(path) === old) throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
      return original(path);
    });
    syncBuiltinESMExports();
    try {
      const result = runCli(['automation-log', '-PassId', 'pass-a', '-Action', 'pass-finished', '-Outcome', 'completed']);
      const value = JSON.parse(result.output);
      assert.equal(result.exitCode, 0);
      assert.equal(value.written, true);
      assert.equal(value.warnings[0].code, 'ASDF_AUTOMATION_LOG_PRUNE_FAILED');
      assert.ok(readFileSync(value.path, 'utf8').includes('outcome=completed'));
    } finally { replacement.mock.restore(); syncBuiltinESMExports(); }
  });

  it('binds worker log calls to the parent pass rather than owner or session identity', () => {
    const { request } = sessionFixture();
    writeRun(42, { schemaVersion: 1, request, state: 'running', cliMode: 'create',
      startedAt: NOW.toISOString(), endedAt: null, host: hostname(), runnerPid: process.pid, childPid: null,
      termination: 'unknown', cliExitCode: null, finalStage: null, error: null, observationError: null });
    writeWorkerClaim(42, { schemaVersion: 1, itemId: 42, runId: request.runId, owner: request.owner, sessionId: request.sessionId,
      host: hostname(), runnerPid: process.pid, childPid: null, phase: 'running', heartbeatAt: NOW.toISOString() });
    setItemStage(42, 'awaiting-answers');
    const previous = process.env.ASDF_WORKER_REQUEST;
    process.env.ASDF_WORKER_REQUEST = runPath(42, request.runId, 'request.json');
    try {
      const args = ['-Action', 'stage-finished', '-Id', '42', '-From', 'new', '-To', 'awaiting-answers', '-Outcome', 'waiting'];
      for (const wrong of [request.owner, request.sessionId]) {
        assert.equal(JSON.parse(runCli(['automation-log', '-PassId', wrong, ...args]).output).error, 'ASDF_BAD_ARGUMENT');
      }
      const good = runCli(['automation-log', '-PassId', request.passId, ...args]);
      assert.equal(good.exitCode, 0);
      assert.ok(readFileSync(JSON.parse(good.output).path, 'utf8').includes(`pass=${request.passId}`));
    } finally {
      if (previous === undefined) delete process.env.ASDF_WORKER_REQUEST;
      else process.env.ASDF_WORKER_REQUEST = previous;
    }
  });
});
