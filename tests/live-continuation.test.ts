import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, it } from 'node:test';
import { artifactPath } from '../scripts/lib/artifacts.ts';
import { newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem, unlockItem } from '../scripts/lib/lock.ts';
import { bindLiveSchedule, enterLiveCheck, finishLiveCheck, prepareLiveWait, stopLiveWatch, suspendLiveWatch } from '../scripts/lib/liveContinuation.ts';
import { readLiveWatch } from '../scripts/lib/liveWatch.ts';
import { loadSetup, prepareSetupSave, saveSetup } from '../scripts/lib/setupState.ts';
import { settingsPath } from '../scripts/lib/settings.ts';
import { newContext, REPO, runCli } from './helpers.ts';

describe('interactive check lifecycle', () => {
  let start: Date;
  beforeEach(() => {
    newContext(); start = new Date();
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Live' });
    setItem(42, { ado: { hldId: 43, hldOwned: true }, hld: { version: 1, approvalRequestedAt: start.toISOString() } });
    setItemStage(42, 'awaiting-approval');
    lockItem(42, 'initial');
  });
  const arm = (start: Date) => {
    const watch = prepareLiveWait(42, 'initial', randomUUID(), 42, start);
    bindLiveSchedule(42, 'initial', watch, 123, start);
    unlockItem(42, 'initial');
    return watch;
  };
  it('renews successful unchanged checks without replacing the schedule', () => {
    const watch = arm(start);
    const tick = new Date(start.getTime() + 5 * 60000);
    assert.equal(enterLiveCheck(42, watch, 'poll', tick).acquired, true);
    const finished = finishLiveCheck(42, watch, 'poll', true, tick);
    assert.equal(finished.generation, watch.generation);
    assert.equal(finished.scheduleId, 123);
    assert.equal(finished.expiresAt, new Date(tick.getTime() + 15 * 60000).toISOString());
    assert.equal(lockItem(42, 'background', tick).acquired, false);
  });
  it('does not renew failed reads and allows fallback after expiry', () => {
    const watch = arm(start);
    const tick = new Date(start.getTime() + 5 * 60000);
    enterLiveCheck(42, watch, 'poll', tick);
    const finished = finishLiveCheck(42, watch, 'poll', false, tick);
    assert.equal(finished.expiresAt, watch.expiresAt);
    assert.equal(lockItem(42, 'background', new Date(start.getTime() + 16 * 60000)).acquired, true);
    assert.equal(enterLiveCheck(42, watch, 'late-poll', new Date(start.getTime() + 17 * 60000)).acquired, false);
  });
  it('fences a duplicate tick and invalidates queued prompts before continuing', () => {
    const watch = arm(start);
    assert.equal(enterLiveCheck(42, watch, 'poll').acquired, true);
    assert.equal(enterLiveCheck(42, watch, 'duplicate').acquired, false);
    const working = suspendLiveWatch(42, watch, 'poll');
    assert.equal(working.generation, watch.generation + 1);
    assert.equal(working.scheduleId, 123);
    assert.throws(() => enterLiveCheck(42, watch, 'late'), { code: 'ASDF_LIVE_STALE' });
    assert.equal(lockItem(42, 'background').acquired, false);
    stopLiveWatch(42, working, 'poll');
    assert.equal(lockItem(42, 'background').acquired, true);
  });
  it('requires current live ownership for CLI mutations and leaves unowned sync untouched', () => {
    const watch = arm(start);
    const before = readFileSync(artifactPath(42, 'state.json'), 'utf8');
    assert.equal(runCli('stage', '-Id', '42', '-Stage', 'approved').json.error, 'ASDF_LOCK_NOT_OWNER');
    const file = artifactPath(42, 'test-signals.json');
    writeFileSync(file, JSON.stringify({ workItem: { assignedToMe: false } }));
    assert.equal(runCli('signals', '-Id', '42', '-File', file).json.processed, false);
    assert.equal(readFileSync(artifactPath(42, 'state.json'), 'utf8'), before);
    enterLiveCheck(42, watch, 'poll');
    assert.equal(runCli('stage', '-Id', '42', '-Stage', 'approved', '-Owner', 'poll').code, 0);
    assert.equal(runCli('session-info', '-Id', '42').json.liveWatch.watchId, watch.watchId);
  });
  it('does not advertise polling before a host schedule is bound and refuses unattended entry', () => {
    const watch = prepareLiveWait(42, 'initial', randomUUID(), 42);
    assert.equal(watch.status, 'preparing');
    assert.equal(enterLiveCheck(42, watch, 'tick').acquired, false);
    const previous = process.env.ASDF_WORKER_REQUEST;
    process.env.ASDF_WORKER_REQUEST = 'background';
    try { assert.throws(() => prepareLiveWait(42, 'initial', watch.threadId, 42), { code: 'ASDF_LIVE_INTERACTIVE_ONLY' }); }
    finally { if (previous === undefined) delete process.env.ASDF_WORKER_REQUEST; else process.env.ASDF_WORKER_REQUEST = previous; }
    stopLiveWatch(42, watch, 'initial');
    assert.equal(readLiveWatch(42)?.status, 'stopped');
  });
  it('admits only one of two independent poll processes', async () => {
    const watch = arm(start);
    const invoke = (owner: string) => promisify(execFile)(process.execPath,
      [join(REPO, 'tests', 'fixtures', 'enter-live.ts'), watch.watchId, String(watch.generation), owner], { env: process.env });
    const results = (await Promise.all([invoke('one'), invoke('two')])).map(r => JSON.parse(r.stdout));
    assert.equal(results.filter(r => r.acquired).length, 1);
    assert.equal(results.filter(r => !r.acquired).length, 1);
  });
  it('allows setup updates without changing a live reservation or its exclusion rules', () => {
    const watch = arm(start);
    const settingsFile = settingsPath();
    const loaded = loadSetup({ settingsFile, mcpFile: join(dirname(settingsFile), 'mcp.json'), copilotSettingsFile: join(dirname(settingsFile), 'copilot.json') });
    const before = readFileSync(artifactPath(42, 'live-watch.json'), 'utf8');
    loaded.draft.config.userName = 'updated';
    saveSetup(prepareSetupSave(loaded));
    assert.equal(readFileSync(artifactPath(42, 'live-watch.json'), 'utf8'), before);
    assert.equal(readLiveWatch(42)?.watchId, watch.watchId);
    assert.equal(lockItem(42, 'background').acquired, false);
    assert.equal(enterLiveCheck(42, watch, 'poll').acquired, true);
  });
  it('allows repeating the same successful bind without a second host schedule', () => {
    const watch = prepareLiveWait(42, 'initial', randomUUID(), 42);
    const bound = bindLiveSchedule(42, 'initial', watch, 123);
    assert.deepEqual(bindLiveSchedule(42, 'initial', watch, 123), bound);
    assert.throws(() => bindLiveSchedule(42, 'initial', watch, 124), { code: 'ASDF_LIVE_STALE' });
  });
  it('recovers an interrupted check after its previous operation lock expires', () => {
    const watch = arm(start);
    enterLiveCheck(42, watch, 'interrupted', start);
    const later = new Date(start.getTime() + 91 * 60000);
    const resumed = enterLiveCheck(42, watch, 'resumed', later);
    assert.equal(resumed.acquired, true);
    assert.equal(resumed.watch?.operationOwner, 'resumed');
    finishLiveCheck(42, watch, 'resumed', false, later);
    assert.equal(readLiveWatch(42)?.status, 'armed');
  });
  it('recovers a preparing watch and replaces an expired missing schedule', () => {
    const watch = prepareLiveWait(42, 'initial', randomUUID(), 42, start);
    const later = new Date(start.getTime() + 91 * 60000);
    assert.equal(enterLiveCheck(42, watch, 'rejoin', later).acquired, true);
    const next = prepareLiveWait(42, 'rejoin', watch.threadId, 42, later);
    bindLiveSchedule(42, 'rejoin', next, 124, later);
    unlockItem(42, 'rejoin');
    const after = new Date(start.getTime() + 120 * 60000);
    lockItem(42, 'manual', after);
    const rearmed = prepareLiveWait(42, 'manual', watch.threadId, 42, after);
    assert.equal(rearmed.status, 'preparing');
    assert.ok(rearmed.generation > next.generation);
    assert.equal(bindLiveSchedule(42, 'manual', rearmed, 125, after).scheduleId, 125);
  });
  it('requires timer reconciliation after recovering a suspended working generation', () => {
    const watch = arm(start);
    enterLiveCheck(42, watch, 'continuing', start);
    const working = suspendLiveWatch(42, watch, 'continuing');
    const later = new Date(start.getTime() + 100 * 60000);
    const resumed = enterLiveCheck(42, working, 'restored', later);
    assert.equal(resumed.acquired, true);
    assert.equal(resumed.reason, 'host schedule needs reconciliation');
    assert.equal(resumed.watch?.scheduleId, null);
    const again = new Date(start.getTime() + 200 * 60000);
    assert.equal(enterLiveCheck(42, working, 'restored-again', again).reason, 'host schedule needs reconciliation');
    const next = prepareLiveWait(42, 'restored-again', watch.threadId, 42, again);
    assert.ok(next.generation > working.generation);
    assert.equal(bindLiveSchedule(42, 'restored-again', next, 124, again).scheduleId, 124);
    assert.throws(() => enterLiveCheck(42, watch, 'old-timer', again), { code: 'ASDF_LIVE_STALE' });
  });
});
