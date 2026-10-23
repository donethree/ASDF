import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { beforeEach, describe, it, mock } from 'node:test';
import { designTarget } from '../scripts/lib/approval.ts';
import { artifactPath } from '../scripts/lib/artifacts.ts';
import { getItem, newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { beginLiveInteraction, consumeDesignFeedback, prepareLiveWait, publishDesignRequest, recordLiveInteraction, suspendLiveWatch } from '../scripts/lib/liveContinuation.ts';
import { getTransition, invokeSignals } from '../scripts/lib/signals.ts';
import { newContext } from './helpers.ts';

describe('live design interactions', () => {
  beforeEach(() => {
    newContext();
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Live' });
    setItem(42, { ado: { hldId: 43, hldOwned: true }, hld: { version: 1, approvalRequestedAt: '2026-10-23T17:00:00Z' } });
    setItemStage(42, 'awaiting-approval');
    lockItem(42, 'chat');
  });
  const current = () => suspendLiveWatch(42, prepareLiveWait(42, 'chat', randomUUID(), 42), 'chat');
  it('keeps feedback pending across failures and background signal checks until revised publication', () => {
    const watch = current();
    const target = designTarget(getItem(42))!;
    const feedback = beginLiveInteraction(42, watch, 'chat', { kind: 'feedback', target, author: 'Reviewer', summary: 'Change the interface' });
    assert.equal(getItem(42).stage, 'answers-received');
    assert.throws(() => setItemStage(42, 'approved'), { code: 'ASDF_DESIGN_REVISION_PENDING' });
    assert.throws(() => publishDesignRequest(42, 'chat', target, 2, new Date(Date.now() + 1000).toISOString()), { code: 'ASDF_DESIGN_REVISION_PENDING' });
    const record = recordLiveInteraction(42, watch, 'chat', feedback.interactionId, 100);
    assert.equal(record.status, 'recorded');
    assert.equal(getTransition({ ...getItem(42), stage: 'awaiting-approval' }, { hld: { stateCategory: 'Completed', stateChangedAt: new Date().toISOString() } }).stage, 'answers-received');
    consumeDesignFeedback(42, 'chat', feedback.interactionId, 'Applied the API revision to the draft');
    publishDesignRequest(42, 'chat', target, 2, new Date(Date.now() + 1000).toISOString());
    assert.equal(getItem(42).hld.pendingFeedback, null);
    assert.equal(getItem(42).stage, 'awaiting-approval');
    assert.equal(getItem(42).hld.version, 2);
  });
  it('records approval once with session provenance only for the current target', () => {
    const watch = current();
    const target = designTarget(getItem(42))!;
    assert.throws(() => beginLiveInteraction(42, watch, 'chat', { kind: 'approval', target: { ...target, version: 0 }, author: 'Reviewer', summary: 'Approved' }), { code: 'ASDF_LIVE_TARGET_CHANGED' });
    const approval = beginLiveInteraction(42, watch, 'chat', { kind: 'approval', target, author: 'Reviewer', summary: 'Approved' });
    assert.equal(getItem(42).stage, 'awaiting-approval');
    recordLiveInteraction(42, watch, 'chat', approval.interactionId, 101);
    assert.equal(getItem(42).stage, 'approved');
    assert.equal(getItem(42).hld.approvedBy, 'Reviewer (session)');
    assert.equal(recordLiveInteraction(42, watch, 'chat', approval.interactionId, 101).status, 'recorded');
    assert.throws(() => recordLiveInteraction(42, watch, 'chat', approval.interactionId, 102), { code: 'ASDF_LIVE_INVALID' });
  });
  it('refuses proxy approval of another owners shared design', () => {
    setItem(42, { ado: { hldOwned: false } });
    const watch = current();
    assert.throws(() => beginLiveInteraction(42, watch, 'chat', { kind: 'approval', target: designTarget(getItem(42))!, author: 'Reviewer', summary: 'Approved' }), { code: 'ASDF_DESIGN_NOT_OWNED' });
  });
  it('allows explicit Feature fallback approval without closing the Feature as a task', () => {
    setItem(42, { kind: 'feature', ado: { hldId: 42, hldOwned: false } });
    const watch = current();
    const approval = beginLiveInteraction(42, watch, 'chat', { kind: 'approval', target: designTarget(getItem(42))!, author: 'Reviewer', summary: 'Approved' });
    recordLiveInteraction(42, watch, 'chat', approval.interactionId, 101);
    assert.equal(getItem(42).stage, 'approved');
    assert.equal(getItem(42).hld.closedAt, null);
  });
  it('reuses pending interaction receipts and does not discard unrecorded feedback', () => {
    const watch = current();
    const input = { kind: 'feedback' as const, target: designTarget(getItem(42))!, author: 'Reviewer', summary: 'Change the interface' };
    const first = beginLiveInteraction(42, watch, 'chat', input);
    assert.equal(beginLiveInteraction(42, watch, 'chat', input).interactionId, first.interactionId);
    assert.throws(() => beginLiveInteraction(42, watch, 'chat', { ...input, summary: 'Also change retention' }),
      { code: 'ASDF_DESIGN_REVISION_PENDING' });
    assert.equal(getItem(42).hld.pendingFeedback.feedbackId, first.interactionId);
  });
  it('does not publish recorded feedback that a resumed writer has not consumed', () => {
    const watch = current();
    const target = designTarget(getItem(42))!;
    const receipt = beginLiveInteraction(42, watch, 'chat', { kind: 'feedback', target, author: 'Reviewer', summary: 'Required change' });
    recordLiveInteraction(42, watch, 'chat', receipt.interactionId, 103);
    assert.throws(() => publishDesignRequest(42, 'chat', target, 2, new Date(Date.now() + 1000).toISOString()),
      { code: 'ASDF_DESIGN_REVISION_PENDING' });
  });
  it('rejects additional feedback without leaving an unreachable receipt', () => {
    const watch = current();
    const input = { kind: 'feedback' as const, target: designTarget(getItem(42))!, author: 'Reviewer', summary: 'First change' };
    const first = beginLiveInteraction(42, watch, 'chat', input);
    recordLiveInteraction(42, watch, 'chat', first.interactionId, 104);
    assert.throws(() => beginLiveInteraction(42, watch, 'chat', { ...input, summary: 'Another change' }),
      { code: 'ASDF_DESIGN_REVISION_PENDING' });
    assert.deepEqual(fs.readdirSync(artifactPath(42, 'live-interactions')), [`${first.interactionId}.json`]);
  });
  it('repairs a receipt-only partial write before an identical retry returns', () => {
    const watch = current();
    const input = { kind: 'feedback' as const, target: designTarget(getItem(42))!, author: 'Reviewer', summary: 'Never drop this change' };
    const original = fs.writeFileSync;
    let denied = false;
    const patched = mock.method(fs, 'writeFileSync', (...args: Parameters<typeof fs.writeFileSync>) => {
      if (!denied && String(args[0]).endsWith('state.json')) {
        denied = true;
        throw Object.assign(new Error('simulated partial write'), { code: 'EPERM' });
      }
      return Reflect.apply(original, fs, args);
    });
    syncBuiltinESMExports();
    try { assert.throws(() => beginLiveInteraction(42, watch, 'chat', input), /simulated partial write/); }
    finally { patched.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(getItem(42).hld.pendingFeedback, undefined);
    const result = invokeSignals(42, { hld: { stateCategory: 'Completed',
      stateChangedAt: new Date(Date.now() + 5000).toISOString() } }, undefined, 'chat');
    assert.equal(result.to, 'answers-received');
    const retry = beginLiveInteraction(42, watch, 'chat', input);
    assert.equal(getItem(42).hld.pendingFeedback?.feedbackId, retry.interactionId);
    assert.equal(getItem(42).stage, 'answers-received');
  });
});
