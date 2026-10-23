import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { designTarget, pendingDesignRevision } from '../scripts/lib/approval.ts';
import { getTransition, isApprovalText } from '../scripts/lib/signals.ts';
import { getItem, newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { newContext } from './helpers.ts';

const requested = '2026-10-23T17:00:00Z';
const done = '2026-10-23T18:00:00Z';
const later = '2026-10-23T18:01:00Z';
const state = { id: 42, kind: 'parent', stage: 'awaiting-approval', ado: { hldId: 43, hldOwned: true },
  hld: { version: 2, approvalRequestedAt: requested } };
const active = { stateCategory: 'InProgress', assignedToMe: true };

describe('shared approval safety', () => {
  it('accepts only unconditional approval forms after markup normalization', () => {
    for (const text of ['Approved', 'Approved!', 'approved, ship it.', '<p>APPROVED.</p>']) assert.equal(isApprovalText(text), true);
    for (const text of ['approved if the tests pass', 'approved, but change this', 'approved?', 'not approved', '[ASDF] approved']) assert.equal(isApprovalText(text), false, text);
  });
  it('later feedback supersedes Done and leaves a durable revision gate', () => {
    const result = getTransition(state, { workItem: active, hld: { stateCategory: 'Completed', stateChangedAt: done,
      comments: [{ createdAt: later, author: 'Reviewer', text: 'Please revise the API' }] } }, later);
    assert.equal(result.stage, 'answers-received');
    assert.equal(result.patch.hld.pendingFeedback.target.version, 2);
    assert.equal(result.patch.hld.pendingFeedback.source, 'ado');
  });
  it('a fresh Done can approve earlier feedback that has not entered a revision', () => {
    assert.equal(getTransition(state, { workItem: active, hld: { stateCategory: 'Completed', stateChangedAt: later,
      comments: [{ createdAt: done, text: 'Please revise' }] } }).stage, 'approved');
  });
  it('prevents automatic or direct advancement while accepted feedback is pending', () => {
    newContext();
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Design' });
    const pending = { feedbackId: 'feedback-1', target: designTarget(state), receivedAt: later, source: 'session', recordedAt: null };
    setItem(42, { ado: state.ado, hld: { ...state.hld, pendingFeedback: pending } });
    setItemStage(42, 'awaiting-approval');
    assert.equal(pendingDesignRevision(getItem(42))?.feedbackId, 'feedback-1');
    assert.equal(getTransition(getItem(42), { workItem: active, hld: { stateCategory: 'Completed', stateChangedAt: later } }).stage, 'answers-received');
    for (const next of ['approved', 'implementing', 'self-review', 'pr-ready']) {
      assert.throws(() => setItemStage(42, next), { code: 'ASDF_DESIGN_REVISION_PENDING' });
    }
    assert.doesNotThrow(() => setItemStage(42, 'merged'));
  });
  it('does not approve a Feature by completing its fallback design item', () => {
    const feature = { ...state, kind: 'feature', ado: { hldId: 42, hldOwned: false } };
    assert.equal(getTransition(feature, { workItem: active, hld: { stateCategory: 'Completed', stateChangedAt: later } }).stage, null);
  });
  it('does not require a nonowning shared-design waiter to publish the owners revision', () => {
    const shared = { ...state, ado: { hldId: 43, hldOwned: false } };
    const feedback = getTransition(shared, { workItem: active, hld: { comments: [{ createdAt: later, text: 'Revising this design' }] } });
    assert.equal(feedback.stage, 'answers-received');
    assert.equal(feedback.patch.hld?.pendingFeedback, undefined);
  });
  it('honors the new design owners approval after recorded feedback is handed off', () => {
    const shared = { ...state, hld: { ...state.hld, designDriver: 'shared', pendingFeedback: {
      feedbackId: 'feedback', target: designTarget(state), receivedAt: done, source: 'ado', recordedAt: done,
      consumedAt: done, delegatedAt: later,
    } } };
    const approved = getTransition(shared, { workItem: active, hld: { stateCategory: 'Completed',
      stateChangedAt: '2026-10-24T10:00:00Z' } });
    assert.equal(approved.stage, 'approved');
    assert.equal(approved.patch.hld.pendingFeedback, null);
  });
});
