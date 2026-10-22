import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getItem, newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { getTransition, invokeSignals, isApprovalText, isMarkedComment, plainText, readyPbis } from '../scripts/lib/signals.ts';
import { newContext } from './helpers.ts';

// Every item below asked its question round, requested approval and posted its blocker comment at REQUESTED.
const NOW = '2026-10-20T12:00:00Z';
const REQUESTED = '2026-10-20T10:00:00Z';
const BEFORE = '2026-10-20T09:00:00Z';
const AFTER = '2026-10-20T11:00:00Z';

// An item at `stage` that resumes to implementing. `changes` replace whole top-level keys.
function itemAt(stage: string, kind = 'parent', changes: Record<string, unknown> = {}) {
  return {
    id: 1, kind, stage, resumeStage: 'implementing',
    hld: { roundPostedAt: REQUESTED, approvalRequestedAt: REQUESTED },
    blocker: { commentAt: REQUESTED },
    ...changes,
  };
}

const comment = (createdAt: string, text: string, author = 'Jane Doe') => ({ createdAt, text, author });
const workItem = (stateCategory: string, assignedToMe = true, parentId?: number | null) => ({ stateCategory, assignedToMe, parentId });
const activeWorkItem = workItem('InProgress');
const parentIn = (stateCategory: string) => ({ stateCategory });
const thread = (status: string, lastCommentIsAsdf: unknown) => ({ status, lastCommentIsAsdf });
const pr = (status: string) => ({ status, threads: [] });
// An active PR that is approved, green and conflict-free unless `changes` say otherwise.
const openPr = (changes: Record<string, unknown> = {}) => ({ status: 'active', approved: true, build: 'succeeded', mergeConflicts: false, threads: [], ...changes });

describe('comment text', () => {
  it('strips HTML, entities and mention anchors', () => {
    assert.equal(plainText('<div><a href="#" data-vss-mention="version:2.0,x">@Jane Doe</a>&nbsp;Approved!</div>'), 'Approved!');
  });

  it('recognizes ASDF comments only by a leading marker', () => {
    assert.equal(isMarkedComment('<p>[ASDF] 2 questions</p>'), true);
    assert.equal(isMarkedComment('thanks [ASDF]'), false);
  });

  for (const text of ['approved', 'Approved, ship it', '<div>APPROVED.</div>', '<div><a data-vss-mention="x">@Bo</a> approved</div>']) {
    it(`accepts the approval '${text}'`, () => assert.equal(isApprovalText(text), true));
  }

  for (const text of ['not approved', 'will be approved after Q2', '[ASDF] Reply approved to approve', 'approve?']) {
    it(`rejects the non-approval '${text}'`, () => assert.equal(isApprovalText(text), false));
  }
});

describe('stage transitions', () => {
  const cases: { name: string; item: object; signals: object; to: string | null }[] = [
    // Picking up work
    { name: 'a tracked parent goes new when it is In Progress', item: itemAt('tracked'), signals: { workItem: activeWorkItem }, to: 'new' },
    { name: 'a tracked parent stays while it is Proposed', item: itemAt('tracked'), signals: { workItem: workItem('Proposed') }, to: null },
    { name: 'a tracked task waits for its parent to be active', item: itemAt('tracked', 'task'), signals: { workItem: workItem('Proposed', true, 9), parent: parentIn('Proposed') }, to: null },
    { name: 'a tracked task goes new when its parent is active', item: itemAt('tracked', 'task'), signals: { workItem: workItem('Proposed', true, 9), parent: parentIn('InProgress') }, to: 'new' },
    { name: 'a task without a parent goes new while Proposed', item: itemAt('tracked', 'task'), signals: { workItem: workItem('Proposed', true, null) }, to: 'new' },
    { name: "a task's own Completed state under an active parent is not picked up", item: itemAt('tracked', 'task'), signals: { workItem: workItem('Completed', true, 9), parent: parentIn('InProgress') }, to: null },
    { name: 'a task waiting for a parent goes new once parented under an active parent', item: itemAt('awaiting-parent', 'task'), signals: { workItem: workItem('Proposed', true, 9), parent: parentIn('InProgress') }, to: 'new' },

    // Question rounds
    { name: 'a human answer after the round', item: itemAt('awaiting-answers'), signals: { workItem: activeWorkItem, hld: { comments: [comment(AFTER, 'Q1 A')] } }, to: 'answers-received' },
    { name: 'an ASDF comment is not an answer', item: itemAt('awaiting-answers'), signals: { workItem: activeWorkItem, hld: { comments: [comment(AFTER, '[ASDF] reminder')] } }, to: null },
    { name: 'a comment from before the round is not an answer', item: itemAt('awaiting-answers'), signals: { workItem: activeWorkItem, hld: { comments: [comment(BEFORE, 'Q1 A')] } }, to: null },

    // HLD approval
    { name: 'an approved comment approves', item: itemAt('awaiting-approval'), signals: { workItem: activeWorkItem, hld: { stateCategory: 'InProgress', comments: [comment(AFTER, '<div>Approved</div>')] } }, to: 'approved' },
    { name: 'an approval from before the request does not count', item: itemAt('awaiting-approval'), signals: { workItem: activeWorkItem, hld: { stateCategory: 'InProgress', comments: [comment(BEFORE, 'approved')] } }, to: null },
    { name: 'a later non-approval wins', item: itemAt('awaiting-approval'), signals: { workItem: activeWorkItem, hld: { stateCategory: 'InProgress', comments: [comment(AFTER, 'approved'), comment('2026-10-20T11:30:00Z', 'wait, one more thing')] } }, to: 'answers-received' },
    { name: 'a Done HLD task approves', item: itemAt('awaiting-approval'), signals: { workItem: activeWorkItem, hld: { stateCategory: 'Completed', stateChangedAt: AFTER, comments: [] } }, to: 'approved' },
    { name: 'an HLD task Done before the request does not approve', item: itemAt('awaiting-approval'), signals: { workItem: activeWorkItem, hld: { stateCategory: 'Completed', stateChangedAt: BEFORE, comments: [] } }, to: null },
    { name: 'an HLD task Done with no state-change time does not approve', item: itemAt('awaiting-approval'), signals: { workItem: activeWorkItem, hld: { stateCategory: 'Completed', comments: [] } }, to: null },
    { name: 'a Done HLD task approves when no request time was recorded', item: itemAt('awaiting-approval', 'parent', { hld: { approvalRequestedAt: null } }), signals: { workItem: activeWorkItem, hld: { stateCategory: 'Completed', comments: [] } }, to: 'approved' },
    { name: 'a reopened HLD sends implementation back to design', item: itemAt('implementing', 'parent', { hld: { closedAt: REQUESTED } }), signals: { workItem: activeWorkItem, hld: { stateCategory: 'InProgress', comments: [] } }, to: 'answers-received' },
    { name: 'an HLD still in progress before ASDF closed it does not stop the build', item: itemAt('approved'), signals: { workItem: activeWorkItem, hld: { stateCategory: 'InProgress', comments: [] } }, to: null },

    // Pull requests
    { name: 'a human PR thread needs work', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ approved: false, threads: [thread('active', false)] }) }, to: 'pr-feedback' },
    { name: 'an active thread ASDF answered waits', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ threads: [thread('active', true)] }) }, to: null },
    { name: 'an approved, green PR is ready', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ threads: [thread('fixed', true)] }) }, to: 'pr-ready' },
    { name: 'a PR without a build policy is ready', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ build: 'none' }) }, to: 'pr-ready' },
    { name: 'a failed build needs work', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ build: 'failed' }) }, to: 'pr-feedback' },
    { name: 'a merge conflict needs work', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ mergeConflicts: true }) }, to: 'pr-feedback' },
    { name: 'a new thread while merging needs work', item: itemAt('merging'), signals: { workItem: activeWorkItem, pr: openPr({ threads: [thread('active', false)] }) }, to: 'pr-feedback' },
    { name: 'an abandoned PR blocks the item', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: pr('abandoned') }, to: 'blocked' },
    { name: 'a completed PR is merged', item: itemAt('merging'), signals: { workItem: activeWorkItem, pr: pr('completed') }, to: 'merged' },
    { name: 'a completed PR is merged even after the parent closed', item: itemAt('merging'), signals: { workItem: workItem('Completed'), pr: pr('completed') }, to: 'merged' },
    { name: 'a PR a reviewer completed is merged even when unassigned', item: itemAt('pr-open'), signals: { workItem: workItem('InProgress', false), pr: pr('completed') }, to: 'merged' },
    { name: 'an item paused while merging is merged when its PR completes', item: itemAt('paused', 'parent', { resumeStage: 'merging' }), signals: { workItem: workItem('Completed'), pr: pr('completed') }, to: 'merged' },
    { name: 'an item paused from pr-open is merged when its PR completes', item: itemAt('paused', 'parent', { resumeStage: 'pr-open' }), signals: { workItem: workItem('Proposed', false), pr: pr('completed') }, to: 'merged' },
    { name: 'an item paused while merging stays paused while its PR is pending', item: itemAt('paused', 'parent', { resumeStage: 'merging' }), signals: { workItem: workItem('Completed'), pr: pr('active') }, to: null },
    { name: 'an item paused from implementing ignores a completed PR', item: itemAt('paused'), signals: { workItem: workItem('Proposed'), pr: pr('completed') }, to: null },

    // Pausing, resuming and blockers
    { name: 'a parent moved back to Proposed pauses the item', item: itemAt('implementing'), signals: { workItem: workItem('Proposed') }, to: 'paused' },
    { name: 'an unassigned item pauses', item: itemAt('implementing'), signals: { workItem: workItem('InProgress', false) }, to: 'paused' },
    { name: "a task's own Removed state under an active parent pauses it", item: itemAt('implementing', 'task'), signals: { workItem: workItem('Removed', true, 9), parent: parentIn('InProgress') }, to: 'paused' },
    { name: 'a paused item resumes', item: itemAt('paused'), signals: { workItem: activeWorkItem }, to: 'implementing' },
    { name: 'a reply unblocks', item: itemAt('blocked'), signals: { workItem: activeWorkItem, blocker: { comments: [comment(AFTER, 'fixed the pipeline')] } }, to: 'implementing' },
    { name: 'a reply does not unblock without a recorded blocker comment time', item: itemAt('blocked', 'parent', { blocker: { commentAt: null } }), signals: { workItem: activeWorkItem, blocker: { comments: [comment('2026-01-05T11:00:00Z', 'old note')] } }, to: null },
    { name: 'a done item never changes', item: itemAt('done'), signals: { workItem: workItem('Removed', false) }, to: null },

    // Flags that do-next writes by hand, as text or numbers, mean what true and false mean
    { name: 'assignedToMe written as the text "false" pauses the item', item: itemAt('implementing'), signals: { workItem: { stateCategory: 'InProgress', assignedToMe: 'false' } }, to: 'paused' },
    { name: 'assignedToMe written as 0 pauses the item', item: itemAt('implementing'), signals: { workItem: { stateCategory: 'InProgress', assignedToMe: 0 } }, to: 'paused' },
    { name: 'a thread ASDF answered, marked with the text "true", waits', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ threads: [thread('active', 'true')] }) }, to: null },
    { name: 'approval written as the text "True" makes a green PR ready', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ approved: 'True' }) }, to: 'pr-ready' },
    { name: 'merge conflicts written as 1 need work', item: itemAt('pr-open'), signals: { workItem: activeWorkItem, pr: openPr({ mergeConflicts: 1 }) }, to: 'pr-feedback' },
  ];

  for (const { name, item, signals, to } of cases) {
    it(name, () => {
      assert.equal(getTransition(item, signals, NOW).stage, to);
    });
  }

  it('records who approved and when', () => {
    const signals = { workItem: activeWorkItem, hld: { stateCategory: 'InProgress', comments: [comment(AFTER, 'approved', 'Jane Doe')] } };
    assert.deepEqual(getTransition(itemAt('awaiting-approval'), signals, NOW).patch, { hld: { approvedBy: 'Jane Doe', approvedAt: AFTER } });
  });
});

describe('Features', () => {
  const featureAt = (stage: string, changes: Record<string, unknown> = {}) => itemAt(stage, 'feature', changes);
  const pbi = (id: number, stateCategory: string) => ({ id, stateCategory });
  // PBI 4121 waits for PBI 4100.
  const PBIS = { pbis: [{ id: 4100, waitsFor: [] }, { id: 4121, waitsFor: [4100] }] };

  it('a Feature goes to pbis-done when every PBI is Completed or Removed', () => {
    const signals = { workItem: activeWorkItem, pbis: [pbi(4100, 'Completed'), pbi(4121, 'Removed')] };
    const transition = getTransition(featureAt('awaiting-pbis'), signals, NOW);
    assert.deepEqual([transition.stage, transition.reason], ['pbis-done', 'every PBI finished']);
  });

  it('a Feature keeps waiting while a PBI is open', () => {
    const signals = { workItem: activeWorkItem, pbis: [pbi(4100, 'Completed'), pbi(4121, 'InProgress')] };
    assert.equal(getTransition(featureAt('awaiting-pbis'), signals, NOW).stage, null);
  });

  it('a Feature keeps waiting when the pass sent no PBIs', () => {
    assert.equal(getTransition(featureAt('awaiting-pbis'), { workItem: activeWorkItem }, NOW).stage, null);
  });

  it('a reopened Breakdown task sends a waiting Feature back to answers-received', () => {
    const reopened = { workItem: activeWorkItem, hld: { stateCategory: 'InProgress', comments: [] } };
    const feature = getTransition(featureAt('awaiting-pbis', { hld: { closedAt: REQUESTED } }), reopened, NOW);
    assert.deepEqual([feature.stage, feature.reason], ['answers-received', 'breakdown reopened']);
    assert.equal(getTransition(itemAt('implementing', 'parent', { hld: { closedAt: REQUESTED } }), reopened, NOW).reason, 'HLD reopened');
  });

  it('a Feature at pbis-done never moves', () => {
    assert.equal(getTransition(featureAt('pbis-done'), { workItem: workItem('Completed') }, NOW).stage, null);
  });

  it("a tracked Feature goes new when it's In Progress", () => {
    assert.equal(getTransition(featureAt('tracked'), { workItem: activeWorkItem }, NOW).stage, 'new');
  });

  it('readyPbis lists a Proposed PBI once everything it waits for is Completed', () => {
    const signals = { pbis: [pbi(4100, 'Completed'), pbi(4121, 'Proposed')] };
    assert.deepEqual(readyPbis(featureAt('awaiting-pbis', { ado: PBIS }), signals), [4121]);
  });

  it('readyPbis leaves out a PBI whose prerequisite is open or Removed, and one already started', () => {
    const feature = featureAt('awaiting-pbis', { ado: PBIS });
    assert.deepEqual(readyPbis(feature, { pbis: [pbi(4100, 'InProgress'), pbi(4121, 'Proposed')] }), []);
    assert.deepEqual(readyPbis(feature, { pbis: [pbi(4100, 'Removed'), pbi(4121, 'Proposed')] }), []);
    assert.deepEqual(readyPbis(feature, { pbis: [pbi(4100, 'Completed'), pbi(4121, 'InProgress')] }), []);
  });

  it('applying signals reports the PBIs ready to start', () => {
    newContext();
    newItem({ org: 'contoso', project: 'Storage', id: 50, kind: 'feature', type: 'Feature', title: 'Move subscription files' });
    setItem(50, { ado: PBIS });
    setItemStage(50, 'awaiting-pbis');
    const signals = { workItem: activeWorkItem, pbis: [pbi(4100, 'Completed'), pbi(4121, 'Proposed')] };
    assert.deepEqual(invokeSignals(50, signals, NOW), { from: 'awaiting-pbis', to: 'awaiting-pbis', reason: null, processed: true, ready: [4121] });
  });
});

describe('applying signals to an item', () => {
  function trackedItem() {
    newContext();
    newItem({ org: 'contoso', project: 'Storage', id: 7, kind: 'parent', type: 'Product Backlog Item', title: 'X' });
  }

  it('moves the item to the stage the rules give', () => {
    trackedItem();
    assert.deepEqual(invokeSignals(7, { workItem: activeWorkItem }, NOW), { from: 'tracked', to: 'new', reason: 'picked up', processed: true });
    assert.equal(getItem(7).stage, 'new');
  });

  it('leaves an item alone while another pass holds its lock', () => {
    trackedItem();
    lockItem(7, 'other pass', NOW);
    assert.deepEqual(invokeSignals(7, { workItem: activeWorkItem }, NOW), { from: 'tracked', to: 'tracked', reason: 'locked by another pass', processed: false });
    assert.equal(getItem(7).stage, 'tracked');
  });
});
