import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { itemPath, newItem } from '../scripts/lib/items.ts';
import { reviewPackage, sddPath, taskBrief, taskDone, taskStart } from '../scripts/lib/sdd.ts';
import { newContext, newItemWorktree, runCli } from './helpers.ts';

const PLAN = ['# P', '### Task 1: Alpha', 'alpha body', '### Task 2: Beta', 'beta body', '## Done', 'trailer'].join('\n');

describe('SDD helpers', () => {
  let plan: string;
  let repo: ReturnType<typeof newItemWorktree>;

  beforeEach(() => {
    const ctx = newContext();
    newItem({ org: 'contoso', project: 'Storage', id: 5, kind: 'parent', type: 'Product Backlog Item', title: 'Sdd' });
    plan = join(itemPath(5)!, 'plan.md');
    writeFileSync(plan, PLAN);
    repo = newItemWorktree(ctx, 5);
    assert.equal(runCli('baseline', '-Id', '5', '-Owner', repo.owner, '-BuildCommand', 'echo build passed').code, 0);
  });

  it('keeps the workspace in the item folder', () => {
    assert.equal(sddPath(5), join(realpathSync.native(itemPath(5)!), 'sdd'));
  });

  it('extracts exactly one task', () => {
    const brief = readFileSync(taskBrief(5, plan, 2), 'utf8');
    assert.match(brief, /beta body/);
    assert.doesNotMatch(brief, /alpha body/);
    assert.doesNotMatch(brief, /trailer/);
  });

  it('fails for a task the plan does not have', () => {
    assert.throws(() => taskBrief(5, plan, 9), { code: 'ASDF_TASK_NOT_FOUND' });
  });

  it('ignores headings inside code fences', () => {
    const fenced = join(itemPath(5)!, 'fenced.md');
    writeFileSync(fenced, ['### Task 1: Fenced', 'before', '```text', '## What changed', '### Task 2: not a task', '```', 'after fence', '### Task 2: Real'].join('\n'));
    const brief = readFileSync(taskBrief(5, fenced, 1), 'utf8');
    assert.match(brief, /after fence/);
    assert.doesNotMatch(brief, /Task 2: Real/);
  });

  it('builds a review package', () => {
    const path = reviewPackage(5, repo.repo, repo.base, repo.head, repo.owner);
    assert.ok(path.endsWith(`review-${repo.base.slice(0, 7)}..${repo.head.slice(0, 7)}.diff`), path);
    assert.match(readFileSync(path, 'utf8'), /second change/);
  });

  it('rejects a ref that does not exist', () => {
    assert.throws(() => reviewPackage(5, repo.repo, 'nope', repo.head, repo.owner), { code: 'ASDF_BAD_REF' });
  });

  it('records a task only when its test command passes, and keeps its output', () => {
    const started = taskStart(5, plan, 1, repo.repo, repo.owner);
    assert.equal(started.base, repo.head);

    assert.equal(taskDone(5, 1, started.base, repo.repo, 'exit 3', repo.owner).recorded, false);
    const passed = taskDone(5, 1, started.base, repo.repo, 'echo tests ran', repo.owner);

    assert.equal(passed.recorded, true);
    assert.match(readFileSync(passed.log, 'utf8'), /tests ran/);
    const ledger = readFileSync(join(sddPath(5), 'ledger.md'), 'utf8');
    assert.match(ledger, /Task 1: complete \(commits [0-9a-f]{7}\.\.[0-9a-f]{7}, tests: echo tests ran → pass\)/);
    assert.doesNotMatch(ledger, /exit 3/);
  });

  it('records a task whose tests fail only on known baseline failures', () => {
    const started = taskStart(5, plan, 1, repo.repo, repo.owner);
    assert.throws(() => taskDone(5, 1, started.base, repo.repo, 'exit 3', repo.owner, 'same restore errors'), { code: 'ASDF_BASELINE_PASSED' });
    assert.equal(runCli('baseline', '-Id', '5', '-Owner', repo.owner, '-BuildCommand', 'exit 4').code, 0);
    const result = runCli('task-done', '-Id', '5', '-TaskNumber', '1', '-Base', started.base, '-RepoPath', repo.repo,
      '-TestCommand', 'exit 3', '-Owner', repo.owner, '-KnownFailure', 'same DX0500 restore errors as baseline');
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.recorded, true);
    assert.equal(result.json.exitCode, 3);
    const ledger = readFileSync(join(sddPath(5), 'ledger.md'), 'utf8');
    assert.match(ledger, /Task 1: complete \(commits [0-9a-f]{7}\.\.[0-9a-f]{7}, tests: exit 3 → known baseline failure: same DX0500 restore errors as baseline\)/);
  });
});
