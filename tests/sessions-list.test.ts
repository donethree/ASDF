import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { prepareLiveWait } from '../scripts/lib/liveContinuation.ts';
import { reserveBinding, writeRun, type WorkerRun } from '../scripts/lib/sessions.ts';
import { newContext, runCli } from './helpers.ts';
import { sessionFixture } from './session-fixtures.ts';

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[relative(root, path)] = readFileSync(path).toString('base64');
    }
  };
  visit(root);
  return files;
}

describe('read-only session listing', () => {
  it('lists Feature and PBI sessions with their hierarchy and current waiting work', () => {
    const { ctx, binding } = sessionFixture(false);
    newItem({ id: 50, org: 'contoso', project: 'Storage', kind: 'feature', type: 'Feature', title: 'Exports' });
    setItem(42, { ado: { parentId: 50, hldId: 43 } });
    setItemStage(42, 'awaiting-answers');
    lockItem(50, 'feature-owner');
    const featureBinding = reserveBinding(50, 'feature-owner');
    const before = snapshot(ctx.context);

    const result = runCli('sessions');

    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.length, 2);
    const pbi = result.json.find((row: { sessionId: string }) => row.sessionId === binding.sessionId);
    assert.deepEqual(pbi.feature, { id: 50, title: 'Exports' });
    assert.deepEqual(pbi.pbi, { id: 42, title: 'Export' });
    assert.equal(pbi.stage, 'awaiting-answers');
    assert.match(pbi.work, /Waiting for answers in ADO/);
    const feature = result.json.find((row: { sessionId: string }) => row.sessionId === featureBinding.sessionId);
    assert.deepEqual(feature.feature, { id: 50, title: 'Exports' });
    assert.equal(feature.pbi, null);
    assert.deepEqual(snapshot(ctx.context), before);
  });

  it('resolves a standalone Task session to its PBI and Feature without a task column', () => {
    newContext();
    newItem({ id: 50, org: 'contoso', project: 'Storage', kind: 'feature', type: 'Feature', title: 'Exports' });
    newItem({ id: 44, org: 'contoso', project: 'Storage', kind: 'task', type: 'Task', title: 'Repair export' });
    setItemStage(44, 'implementing');
    lockItem(44, 'task-owner');
    const binding = reserveBinding(44, 'task-owner');
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'PBI', title: 'Export', parentId: 50 });
    setItem(44, { ado: { parentId: 42 } });

    const result = runCli('sessions');

    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.length, 1);
    assert.equal(result.json[0].sessionId, binding.sessionId);
    assert.deepEqual(result.json[0].feature, { id: 50, title: 'Exports' });
    assert.deepEqual(result.json[0].pbi, { id: 42, title: 'Export' });
    assert.match(result.json[0].work, /Repair export/);
    assert.equal(Object.hasOwn(result.json[0], 'task'), false);
  });

  it('includes recorded interactive sessions and does not invent sessions for other items', () => {
    const ctx = newContext();
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'PBI', title: 'Export' });
    setItem(42, { ado: { prId: 99 } });
    setItemStage(42, 'pr-open');
    lockItem(42, 'live-owner');
    const threadId = randomUUID();
    prepareLiveWait(42, 'live-owner', threadId, 42);
    newItem({ id: 50, org: 'contoso', project: 'Storage', kind: 'feature', type: 'Feature', title: 'Not started' });
    const before = snapshot(ctx.context);

    const result = runCli('sessions');

    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.length, 1);
    assert.equal(result.json[0].sessionId, threadId);
    assert.equal(result.json[0].mode, 'interactive');
    assert.equal(result.json[0].status, 'preparing');
    assert.deepEqual(result.json[0].pbi, { id: 42, title: 'Export' });
    assert.equal(result.json[0].feature, null);
    assert.deepEqual(snapshot(ctx.context), before);
  });

  it('reports the current run state and failures instead of claiming a terminal is open', () => {
    const { request } = sessionFixture(false);
    const run: WorkerRun = { schemaVersion: 1, request, state: 'failed', cliMode: 'create',
      startedAt: '2026-10-28T10:00:00Z', endedAt: '2026-10-28T10:01:00Z', host: 'test',
      runnerPid: process.pid, childPid: null, termination: 'closed', cliExitCode: 1, finalStage: 'new',
      error: { code: 'ASDF_WORKER_FAILED', message: 'Worker exited before completing' }, observationError: null };
    writeRun(42, run);

    const result = runCli('sessions');

    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json[0].status, 'failed');
    assert.match(result.json[0].work, /ASDF_WORKER_FAILED: Worker exited before completing/);
  });

  it('does not resolve hierarchy through an item in a different project', () => {
    sessionFixture(false);
    newItem({ id: 50, org: 'contoso', project: 'Other', kind: 'feature', type: 'Feature', title: 'Unrelated' });
    setItem(42, { ado: { parentId: 50 } });

    const result = runCli('sessions');

    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.deepEqual(result.json[0].pbi, { id: 42, title: 'Export' });
    assert.equal(result.json[0].feature, null);
  });

  it('returns an empty list when no sessions have been recorded', () => {
    newContext();
    const result = runCli('sessions');
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.deepEqual(result.json, []);
  });
});
