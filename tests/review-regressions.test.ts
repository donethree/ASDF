import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { guardDecision } from '../scripts/lib/guard.ts';
import { getItem, newItem, setItem, setItemRepo, setItemStage } from '../scripts/lib/items.ts';
import { getQueue } from '../scripts/lib/queue.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { findRepoSkills } from '../scripts/lib/repoSkills.ts';
import { reviewPackage } from '../scripts/lib/sdd.ts';
import { getConfig, setConfig } from '../scripts/lib/settings.ts';
import { getTransition } from '../scripts/lib/signals.ts';
import { git, newContext, newFolder, newItemWorktree, newWorkspace, runCli } from './helpers.ts';

const parent = (id: number, org = 'contoso') =>
  newItem({ org, project: 'Commerce', id, kind: 'parent', type: 'User Story', title: 'Export orders' });

describe('ownership and PR lifecycle regressions', () => {
  it('lets a lock owner apply signals without unlocking the item', () => {
    const ctx = newContext();
    parent(100);
    lockItem(100, 'session-owner');
    const file = join(ctx.context, 'signals.json');
    writeFileSync(file, JSON.stringify({ workItem: { assignedToMe: true, stateCategory: 'InProgress' } }));
    const denied = runCli('signals', '-Id', '100', '-File', file, '-Owner', 'other-owner');
    assert.equal(denied.json.error, 'ASDF_LOCK_NOT_OWNER');
    assert.equal(getItem(100).stage, 'tracked');
    const accepted = runCli('signals', '-Id', '100', '-File', file, '-Owner', 'session-owner');
    assert.equal(accepted.code, 0);
    assert.equal(accepted.json.to, 'new');
  });
  it('does not activate a reassigned Task when its parent becomes active', () => {
    const result = getTransition({ kind: 'task', stage: 'awaiting-parent' }, {
      workItem: { assignedToMe: false, stateCategory: 'Proposed', parentId: 100 },
      parent: { stateCategory: 'InProgress' },
    });
    assert.equal(result.stage, 'paused');
  });

  for (const stage of ['pr-feedback', 'pr-ready', 'blocked', 'answers-received', 'paused']) {
    it(`recognizes an externally completed PR from ${stage}`, () => {
      const result = getTransition({ kind: 'parent', stage, resumeStage: 'pr-feedback', ado: { prId: 17 } }, {
        workItem: { assignedToMe: false, stateCategory: 'Completed' },
        pr: { status: 'completed' },
      });
      assert.equal(result.stage, 'merged');
    });
  }

  for (const stage of ['pr-feedback', 'pr-ready']) {
    it(`blocks an abandoned PR from ${stage}`, () => {
      assert.equal(getTransition({ kind: 'parent', stage, ado: { prId: 17 } }, {
        workItem: { assignedToMe: true, stateCategory: 'InProgress' },
        pr: { status: 'abandoned' },
      }).stage, 'blocked');
    });
  }

  it('keeps a close-out blocker until a person replies, even after the governing item closes', () => {
    const state = {
      kind: 'task', stage: 'blocked', resumeStage: 'merged', ado: { prId: 17 },
      blocker: { commentAt: '2026-10-21T10:00:00Z' },
    };
    const signals = {
      workItem: { assignedToMe: false, stateCategory: 'Completed' },
      pr: { status: 'completed' },
    };
    assert.equal(getTransition(state, signals).stage, null);
    const reply = { ...signals, blocker: { comments: [{ createdAt: '2026-10-21T11:00:00Z', text: 'Preserved the follow-up work' }] } };
    assert.equal(getTransition(state, reply).stage, 'merged');
    assert.equal(getTransition(state, reply).reason, 'unblocked');
  });

  it('keeps another organization out of the owned-task id check', () => {
    newContext();
    parent(100);
    setItem(100, { ado: { hldId: 101 } });
    assert.equal(parent(101, 'fabrikam').org, 'fabrikam');
  });

  it('does not create an independent item for an untagged design task', () => {
    newContext();
    assert.throws(() => newItem({
      org: 'contoso', project: 'Commerce', id: 101, kind: 'task', type: 'Task',
      title: 'HLD: Export orders', parentId: 100,
    }), { code: 'ASDF_OWN_TASK' });
  });

  it('does not create an independent implementation Task under a tracked PBI', () => {
    newContext();
    parent(100);
    assert.throws(() => newItem({
      org: 'contoso', project: 'Commerce', id: 102, kind: 'task', type: 'Task',
      title: 'Add export logging', parentId: 100,
    }), { code: 'ASDF_OWN_TASK' });
  });

  it('excludes already-tracked child Tasks after their parent or role is adopted', () => {
    newContext();
    newItem({ org: 'contoso', project: 'Commerce', id: 102, kind: 'task', type: 'Task', title: 'Logging', parentId: 100 });
    setItemStage(102, 'new');
    parent(100);
    setItemStage(100, 'new');
    assert.deepEqual(getQueue().map((item) => item.id), [100]);
    assert.throws(() => newItem({
      org: 'contoso', project: 'Commerce', id: 102, kind: 'task', type: 'Task', title: 'Logging', parentId: 100,
    }), { code: 'ASDF_OWN_TASK' });
    assert.equal(getItem(102).stage, 'new');
  });

  it('preserves standalone Task work when its tracked parent is paused', () => {
    newContext();
    parent(100);
    setItemStage(100, 'paused', 'not assigned');
    newItem({ org: 'contoso', project: 'Commerce', id: 102, kind: 'task', type: 'Task', title: 'Logging', parentId: 100 });
    setItemStage(102, 'new');
    assert.deepEqual(getQueue().map((item) => item.id), [102]);
  });

  it('keeps an existing child PR actionable when the parent is tracked later', () => {
    newContext();
    newItem({ org: 'contoso', project: 'Commerce', id: 102, kind: 'task', type: 'Task', title: 'Logging', parentId: 100 });
    setItem(102, { ado: { prId: 17 } });
    setItemStage(102, 'pr-feedback');
    parent(100);
    setItemStage(100, 'new');
    assert.deepEqual(getQueue().map((item) => item.id), [102, 100]);
  });

  it('does not absorb a standalone Task whose design is already under way', () => {
    newContext();
    newItem({ org: 'contoso', project: 'Commerce', id: 102, kind: 'task', type: 'Task', title: 'Logging', parentId: 100 });
    setItem(102, { hld: { roundPostedAt: '2026-10-21T10:00:00Z' } });
    setItemStage(102, 'new');
    parent(100);
    assert.deepEqual(getQueue().map((item) => item.id), [102]);
  });
});

describe('Git command parsing regressions', () => {
  const decide = (command: string) => guardDecision('powershell', { command }, 'user/jdoe');
  for (const option of ['--git-dir .git', '--work-tree "C:\\work tree"', '--namespace example', '--config-env color.ui=COLOR']) {
    it(`rejects a protected push after ${option}`, () => {
      assert.match(decide(`git ${option} push origin main`) ?? '', /ASDF guard:/);
      assert.equal(decide(`git ${option} push origin user/jdoe/12-export`), null);
    });
  }
  it('understands equals options with quoted spaces and explicit --repo', () => {
    assert.match(decide('git --git-dir="C:\\work tree\\.git" push origin main') ?? '', /ASDF guard:/);
    assert.match(decide('git push --repo origin HEAD:main') ?? '', /ASDF guard:/);
    assert.equal(decide('git push --repo=origin -o ci.skip HEAD:user/jdoe/12-export'), null);
  });
  it('does not allow an unrecognized global option to conceal a push', () => {
    assert.match(decide('git --unknown-global value push origin main') ?? '', /ASDF guard:/);
  });
});

describe('workspace and memory identity regressions', () => {
  it('allows equally named repositories in distinct projects and supports explicit selection', () => {
    const ctx = newContext();
    const other = newWorkspace(join(ctx.src, 'other'), 'https://dev.azure.com/contoso/Commerce/_git/Storage');
    setConfig({ ...getConfig(), workspaces: [ctx.workspace, other] });
    parent(100);
    assert.throws(() => setItemRepo(100, 'Storage'), { code: 'ASDF_NO_WORKSPACE' });
    const result = runCli('item-repo', '-Id', '100', '-Name', 'Storage', '-Org', 'contoso', '-Project', 'Commerce');
    assert.equal(result.code, 0);
    assert.equal(result.json.repo.clonePath, other);
  });

  it('gives repository memory a qualified, filesystem-safe identity', () => {
    const ctx = newContext();
    const pathFor = (org: string, project: string, repo: string) =>
      runCli('memory-path', '-Org', org, '-Project', project, '-Repo', repo);
    const first = pathFor('Contoso', 'Commerce', 'Orders');
    assert.equal(first.code, 0);
    assert.equal(first.json.path, join(ctx.context, 'memory', 'org-contoso', 'project-commerce', 'repo-orders.md'));
    assert.equal(pathFor('CONTOSO', 'COMMERCE', 'ORDERS').json.path, first.json.path);
    assert.notEqual(pathFor('fabrikam', 'Commerce', 'Orders').json.path, first.json.path);
    assert.notEqual(pathFor('contoso', 'Reports', 'Orders').json.path, first.json.path);
    assert.equal(pathFor('CON', '..', '../Orders').json.path,
      join(ctx.context, 'memory', 'org-con', 'project-%2E%2E', 'repo-%2E%2E%2Forders.md'));
  });
});

describe('review artifacts and failure reporting', () => {
  it('rejects a review package when git cannot produce the patch', () => {
    const ctx = newContext();
    parent(100);
    const { repo, base, head, owner } = newItemWorktree(ctx, 100);
    git('-C', repo, 'config', 'diff.external', 'asdf-nonexistent-diff-command');
    assert.throws(() => reviewPackage(100, repo, base, head, owner), { code: 'ASDF_GIT_FAILED' });
  });

  it('exits unsuccessfully when task-done tests fail, without recording completion', () => {
    const ctx = newContext();
    parent(100);
    const { repo, head, owner } = newItemWorktree(ctx, 100);
    const result = runCli('task-done', '-Id', '100', '-TaskNumber', '1', '-Base', head, '-RepoPath', repo, '-TestCommand', 'exit 3', '-Owner', owner);
    assert.equal(result.code, 3);
    assert.equal(result.json.exitCode, 3);
    assert.equal(result.json.recorded, false);
    assert.equal(typeof readFileSync(result.json.log, 'utf8'), 'string');
  });
});

describe('multiline skill descriptions', () => {
  for (const indicator of ['>', '>-', '|', '|+']) {
    it(`discovers a reviewer with a ${indicator} description`, () => {
      const root = newFolder();
      const file = join(root, '.github', 'skills', 'quality', 'SKILL.md');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `---\nname: quality\ndescription: ${indicator}\n  Review changes for\n  repository conventions.\n---\nBody\n`);
      const found = findRepoSkills(root, 'review');
      assert.deepEqual(found.map((skill) => skill.name), ['quality']);
      assert.match(found[0].description, /repository conventions/);
    });
  }
});
