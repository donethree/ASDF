import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { designTarget } from '../scripts/lib/approval.ts';
import { artifactPath } from '../scripts/lib/artifacts.ts';
import { newItem, setItem, setItemStage, getItem } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { beginLiveInteraction, consumeDesignFeedback, observeDesignDriver, prepareLiveWait, publishDesignRequest,
  readDesignFeedback, recordDesignFeedback, stopLiveWatch, suspendLiveWatch } from '../scripts/lib/liveContinuation.ts';
import { invokeSignals } from '../scripts/lib/signals.ts';
import { newContext, runCli } from './helpers.ts';

function pending() {
  newContext();
  newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Feedback' });
  setItem(42, { ado: { hldId: 43, hldOwned: true }, hld: { version: 1, approvalRequestedAt: '2026-10-23T17:00:00Z' } });
  setItemStage(42, 'awaiting-approval'); lockItem(42, 'live');
  const watch = suspendLiveWatch(42, prepareLiveWait(42, 'live', randomUUID(), 42), 'live');
  const target = designTarget(getItem(42))!;
  const receipt = beginLiveInteraction(42, watch, 'live', { kind: 'feedback', target, author: 'Person', summary: 'Keep the old API compatible' });
  stopLiveWatch(42, watch, 'live');
  lockItem(42, 'background');
  return { target, receipt };
}

describe('feedback continuation under fresh ownership', () => {
  it('reconciles and consumes stopped-session feedback before background publication', () => {
    const { target, receipt } = pending();
    assert.equal(readDesignFeedback(42, 'background').interaction?.summary, 'Keep the old API compatible');
    recordDesignFeedback(42, 'background', receipt.interactionId, 121);
    assert.throws(() => publishDesignRequest(42, 'background', target, 2, new Date(Date.now() + 1000).toISOString()),
      { code: 'ASDF_DESIGN_REVISION_PENDING' });
    consumeDesignFeedback(42, 'background', receipt.interactionId, 'Revised hld.md to preserve the old API');
    publishDesignRequest(42, 'background', target, 2, new Date(Date.now() + 1000).toISOString());
    assert.equal(getItem(42).hld.pendingFeedback, null);
    assert.equal(getItem(42).stage, 'awaiting-approval');
  });
  it('waits for the current shared design owner rather than cycling pending revisions', () => {
    const { receipt } = pending();
    recordDesignFeedback(42, 'background', receipt.interactionId, 122);
    consumeDesignFeedback(42, 'background', receipt.interactionId, 'Recorded and forwarded the change for the current owner');
    observeDesignDriver(42, 'background', 'shared');
    setItemStage(42, 'awaiting-approval');
    const result = invokeSignals(42, { workItem: { assignedToMe: true, stateCategory: 'InProgress' },
      hld: { stateCategory: 'Completed', stateChangedAt: new Date(Date.now() + 5000).toISOString() } }, undefined, 'background');
    assert.equal(result.to, 'approved');
    assert.equal(getItem(42).hld.pendingFeedback, null);
    assert.equal(getItem(42).ado.hldOwned, true);
    assert.equal(getItem(42).hld.designDriver, 'shared');
  });
  it('continues feedback through CLI preflight and publication without an old live key', () => {
    const { target, receipt } = pending();
    const cli = (name: string, ...args: string[]) => runCli(name, '-Id', '42', '-Owner', 'background', ...args);
    const info = cli('design-feedback-info');
    assert.equal(info.code, 0, JSON.stringify(info.json));
    assert.equal(info.json.interaction.summary, 'Keep the old API compatible');
    const targetFile = artifactPath(42, 'target.json');
    writeFileSync(targetFile, JSON.stringify(target));
    const publishArgs = ['-File', targetFile, '-Version', '2', '-RequestedAt', new Date(Date.now() + 10000).toISOString()];
    assert.equal(cli('design-request-check', ...publishArgs).json.error, 'ASDF_DESIGN_REVISION_PENDING');
    assert.equal(cli('design-feedback-recorded', '-InteractionId', receipt.interactionId, '-CommentId', '123').code, 0);
    assert.equal(cli('design-request-check', ...publishArgs).json.error, 'ASDF_DESIGN_REVISION_PENDING');
    assert.equal(cli('design-feedback-consume', '-FeedbackId', receipt.interactionId, '-Summary', 'Updated the compatibility section').code, 0);
    assert.equal(cli('design-role', '-Mode', 'owned').code, 0);
    assert.equal(cli('design-request-check', ...publishArgs).code, 0);
    assert.equal(getItem(42).hld.version, 1);
    assert.equal(cli('design-request', ...publishArgs).code, 0);
    assert.equal(getItem(42).hld.version, 2);
    assert.equal(cli('design-feedback-recorded', '-InteractionId', receipt.interactionId, '-CommentId', '123').code, 0);
    assert.equal(getItem(42).hld.pendingFeedback, null);
  });
});
