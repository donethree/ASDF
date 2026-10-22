import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { getItem, itemPath, newItem, setItem, setItemStage, slugify } from '../scripts/lib/items.ts';
import { newContext, type TestContext } from './helpers.ts';

const NOW = '2026-10-20T12:00:00Z';

function newParent(id: number, title = 'T') {
  return newItem({ org: 'contoso', project: 'Storage', id, kind: 'parent', type: 'Product Backlog Item', title, now: NOW });
}

function newTask(id: number, title: string) {
  return newItem({ org: 'contoso', project: 'Storage', id, kind: 'task', type: 'Task', title });
}

describe('slugify', () => {
  it('lower-cases and puts dashes between words', () => {
    assert.equal(slugify('Add CSV export (v2)!'), 'add-csv-export-v2');
  });

  it('drops accents', () => {
    assert.equal(slugify('Ünïcödé — CSV'), 'unicode-csv');
  });

  it('stops at 40 characters, on a word boundary', () => {
    const slug = slugify('word '.repeat(20));
    assert.ok(slug.length <= 40);
    assert.doesNotMatch(slug, /-$/);
  });

  it('falls back to "item" when nothing is left', () => {
    assert.equal(slugify('!!!'), 'item');
  });
});

describe('items', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = newContext();
  });

  it('creates the folder layout at stage tracked', () => {
    const item = newParent(12345, 'Add CSV export');
    const folder = join(ctx.context, '12345-add-csv-export');
    for (const part of ['state.json', 'diagrams', 'reviews']) assert.ok(existsSync(join(folder, part)), part);
    assert.equal(item.stage, 'tracked');
    assert.equal(item.stats.stageEnteredAt.tracked, NOW);
    assert.equal(item.ado.hldOwned, false);
    assert.deepEqual(Object.keys(item.repo), ['name', 'org', 'project', 'clonePath', 'worktreePath', 'branch']);
    assert.equal(item.size, null);
    assert.deepEqual(item.ado.pbis, []);
  });

  it('tracks a Feature, with no branch', () => {
    const feature = newItem({ org: 'contoso', project: 'Storage', id: 50, kind: 'feature', type: 'Feature', title: 'Move subscription files' });
    assert.equal(feature.kind, 'feature');
    assert.equal(feature.repo.branch, null);
  });

  it('moves a Feature through its own stages', () => {
    newItem({ org: 'contoso', project: 'Storage', id: 50, kind: 'feature', type: 'Feature', title: 'Move subscription files' });
    assert.equal(setItemStage(50, 'awaiting-pbis').stage, 'awaiting-pbis');
    assert.equal(setItemStage(50, 'pbis-done').stage, 'pbis-done');
  });

  it('rejects an unknown kind', () => {
    const epic = { org: 'contoso', project: 'Storage', id: 60, kind: 'epic', type: 'Epic', title: 'Too big' };
    assert.throws(() => newItem(epic), { code: 'ASDF_BAD_ARGUMENT', message: /parent, task or feature/ });
  });

  it('is idempotent, and keeps the folder when the title changes', () => {
    newParent(12345, 'Add CSV export');
    newParent(12345, 'Renamed');
    assert.deepEqual(readdirSync(ctx.context).filter((name) => name.startsWith('12345-')), ['12345-add-csv-export']);
    assert.match(itemPath(12345) ?? '', /12345-add-csv-export$/);
  });

  it('does not confuse item 123 with item 12345', () => {
    newParent(12345);
    assert.equal(itemPath(123), null);
  });

  it('counts question and PR rounds, and remembers the stage to resume', () => {
    newParent(1);
    setItemStage(1, 'new');
    setItemStage(1, 'awaiting-answers');
    assert.equal(getItem(1).stats.questionRounds, 1);

    setItemStage(1, 'blocked', 'build broken');
    const paused = setItemStage(1, 'paused');
    assert.equal(paused.resumeStage, 'awaiting-answers');
    assert.equal(paused.lastReason, 'build broken');

    assert.equal(setItemStage(1, 'awaiting-answers').resumeStage, null);
    assert.equal(setItemStage(1, 'pr-feedback').stats.prRounds, 1);
  });

  it('rejects an unknown stage', () => {
    newParent(1);
    assert.throws(() => setItemStage(1, 'bogus'), { code: 'ASDF_STAGE_UNKNOWN' });
  });

  it('names the branch user/<userName>/<id>-<slug>', () => {
    assert.equal(newParent(12345, 'Add CSV export').repo.branch, 'user/jdoe/12345-add-csv-export');
  });

  it('refuses an id that another org already uses', () => {
    newParent(30);
    const otherOrg = { org: 'fabrikam', project: 'Web', id: 30, kind: 'parent', type: 'User Story', title: 'Other org' };
    assert.throws(() => newItem(otherOrg), { code: 'ASDF_ID_CLASH' });
    assert.equal(newParent(30).org, 'contoso');
  });

  it('records the blocker comment time, work item and reason when blocking', () => {
    newParent(1);
    setItemStage(1, 'implementing');
    assert.deepEqual(setItemStage(1, 'blocked', 'no clone', null, NOW).blocker, { workItemId: 1, commentAt: NOW, reason: 'no clone' });
    assert.equal(setItemStage(1, 'blocked', 'x', 77, NOW).blocker.workItemId, 77);
    assert.equal(setItemStage(1, 'paused').blocker.reason, 'x');
    assert.equal(setItemStage(1, 'implementing').blocker.commentAt, null);
  });

  it('requires a reason to block', () => {
    newParent(1);
    assert.throws(() => setItemStage(1, 'blocked'), { code: 'ASDF_REASON_REQUIRED' });
  });

  it('refuses to track a task ASDF created or adopted for another item', () => {
    newParent(1);
    setItem(1, { ado: { hldId: 501, reviewId: 502, implIds: [503, 504] } });
    for (const ownTask of [501, 502, 504]) {
      assert.throws(() => newTask(ownTask, 'HLD: T'), { code: 'ASDF_OWN_TASK' }, String(ownTask));
    }
    assert.equal(itemPath(501), null);
    assert.equal(newTask(505, 'Other').stage, 'tracked');
  });

  it('deep-merges patches, and never patches the stage', () => {
    newParent(1);
    setItem(1, { ado: { hldId: 12346 } });
    const item = getItem(1);
    assert.equal(item.ado.hldId, 12346);
    assert.deepEqual(item.ado.implIds, []);
    assert.throws(() => setItem(1, { stage: 'done' }), { code: 'ASDF_PATCH_FORBIDDEN_KEY' });
  });

  it('fails for an item that is not tracked', () => {
    assert.throws(() => getItem(999), { code: 'ASDF_ITEM_NOT_FOUND' });
  });
});
