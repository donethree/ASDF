import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { artifactPath } from '../scripts/lib/artifacts.ts';
import { newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem, unlockItem } from '../scripts/lib/lock.ts';
import { getQueueReport } from '../scripts/lib/queue.ts';
import { isLiveReserved, readLiveWatch, validateLiveKey, writeLiveWatch, type LiveWatch } from '../scripts/lib/liveWatch.ts';
import { writeWorkerClaim } from '../scripts/lib/workerLease.ts';
import { newContext } from './helpers.ts';

const START = new Date('2026-10-23T18:00:00Z');
const minute = (n: number) => new Date(START.getTime() + n * 60000);
describe('live reservations', () => {
  let watch: LiveWatch;
  beforeEach(() => {
    newContext();
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Live' });
    setItem(42, { ado: { hldId: 43 }, hld: { version: 1, approvalRequestedAt: START.toISOString() } });
    setItemStage(42, 'awaiting-approval');
    watch = { schemaVersion: 1, item: { id: 42, org: 'contoso', project: 'Storage' }, threadId: randomUUID(), rootItemId: 42,
      watchId: randomUUID(), generation: 1, status: 'armed', waitStage: 'awaiting-approval',
      target: { designId: 43, version: 1, requestedAt: START.toISOString(), roundPostedAt: null },
      prId: null, scheduleId: 1, operationOwner: null, lastSuccessfulCheckAt: START.toISOString(), expiresAt: minute(15).toISOString() };
  });
  it('excludes unrelated owners until expiry but permits matching controller ownership', () => {
    writeLiveWatch(42, watch);
    assert.equal(lockItem(42, 'automatic', minute(5)).acquired, false);
    assert.equal(lockItem(42, 'poll', minute(5), watch).acquired, true);
    assert.equal(unlockItem(42, 'poll').removed, true);
    assert.equal(lockItem(42, 'automatic', minute(15)).acquired, true);
  });
  it('rejects foreign identities and stale generations', () => {
    assert.throws(() => writeLiveWatch(42, { ...watch, item: { ...watch.item, org: 'other' } }), { code: 'ASDF_LIVE_INVALID' });
    writeLiveWatch(42, watch);
    assert.throws(() => validateLiveKey(42, { ...watch, generation: 2 }), { code: 'ASDF_LIVE_STALE' });
    assert.throws(() => lockItem(42, 'poll', minute(5), { ...watch, generation: 2 }), { code: 'ASDF_LIVE_STALE' });
  });
  it('keeps malformed watches visible as ownership errors rather than unlocked', () => {
    writeFileSync(artifactPath(42, 'live-watch.json'), '{}');
    setItemStage(42, 'new');
    assert.throws(() => readLiveWatch(42), { code: 'ASDF_LIVE_INVALID' });
    assert.equal(getQueueReport(minute(5)).deferred[0].error?.code, 'ASDF_LIVE_INVALID');
  });
  it('does not use a stopped or working watch as a permanent idle claim', () => {
    assert.equal(isLiveReserved(watch, minute(14)), true);
    assert.equal(isLiveReserved(watch, minute(15)), false);
    assert.equal(isLiveReserved({ ...watch, status: 'stopped' }, minute(5)), false);
    assert.equal(isLiveReserved({ ...watch, status: 'working' }, minute(5)), false);
  });
  it('does not override a persistent worker claim even after live expiry', () => {
    const owner = randomUUID();
    lockItem(42, owner, START);
    writeWorkerClaim(42, { schemaVersion: 1, itemId: 42, runId: owner, owner, sessionId: randomUUID(), host: 'test',
      runnerPid: process.pid, childPid: null, phase: 'running', heartbeatAt: START.toISOString() });
    writeLiveWatch(42, watch);
    assert.equal(lockItem(42, 'poll', minute(16), watch).acquired, false);
  });
});
