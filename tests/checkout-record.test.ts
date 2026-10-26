import assert from 'node:assert/strict';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { getItem, newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { git, newContext, newFolder, newItemWorktree, newWorkspace, runCli, type TestContext } from './helpers.ts';

describe('recording a README-created or existing checkout', () => {
  let ctx: TestContext;
  let work: ReturnType<typeof newItemWorktree>;
  beforeEach(() => {
    ctx = newContext();
    newItem({ id: 201, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Orders' });
    work = newItemWorktree(ctx, 201);
    setItemStage(201, 'implementing');
  });
  const record = (path: string, owner = work.owner, id = '201') =>
    runCli('checkout-record', '-Id', id, '-Owner', owner, '-Path', path, '-Reason', 'README feature-branch procedure');
  const command = (name: string, ...args: string[]) => runCli(name, '-Id', '201', '-Owner', work.owner, ...args);

  it('adopts an existing user branch with commits in the configured checkout without moving it', () => {
    assert.equal(command('baseline', '-BuildCommand', 'echo build passed').code, 0);
    git('-C', work.workspace, 'switch', '-qc', 'user/jdoe/my-feature');
    git('-C', work.workspace, 'commit', '-q', '--allow-empty', '-m', 'my earlier work');
    const head = git('-C', work.workspace, 'rev-parse', 'HEAD');
    const result = record(work.workspace);
    assert.equal(result.code, 0, JSON.stringify(result.json));
    const repo = getItem(201).repo;
    assert.equal(repo.branch, 'user/jdoe/my-feature');
    assert.equal(repo.worktreePath, work.workspace);
    assert.equal(repo.checkoutMode, 'source');
    assert.equal(repo.sourceFallback, null);
    assert.equal(git('-C', work.workspace, 'rev-parse', 'HEAD'), head);
    assert.equal(git('-C', work.workspace, 'branch', '--show-current'), 'user/jdoe/my-feature');
    const context = command('execution-context');
    assert.equal(context.code, 0, JSON.stringify(context.json));
    assert.equal(context.json.codeRoot, work.workspace);
    assert.equal(context.json.checkoutMode, 'source');
    assert.equal(command('code-path', '-Path', 'orders.ts').json.error, 'ASDF_BASELINE_REQUIRED');
    assert.equal(command('baseline', '-BuildCommand', 'echo build passed').code, 0);
    assert.equal(command('code-path', '-Path', 'orders.ts').code, 0);
  });

  it('accepts a README-created worktree with its own branch name and base', () => {
    const readme = join(newFolder('readme-worktree'), 'wt');
    git('-C', work.workspace, 'worktree', 'add', '-q', '-b', 'user/jdoe/readme-name', readme, work.base);
    const result = record(readme);
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(getItem(201).repo.branch, 'user/jdoe/readme-name');
    assert.equal(getItem(201).repo.checkoutMode, 'worktree');
    const context = command('execution-context');
    assert.equal(context.code, 0, JSON.stringify(context.json));
    assert.equal(context.json.codeRoot, readme);
  });

  it('rejects unpushable branches, detached checkouts and other repositories without changing the item', () => {
    git('-C', work.workspace, 'switch', '-qc', 'feature/elsewhere');
    assert.equal(record(work.workspace).json.error, 'ASDF_CHECKOUT_RECORD');
    git('-C', work.workspace, 'switch', '-qc', 'main-copy');
    git('-C', work.workspace, 'checkout', '-q', '--detach');
    assert.equal(record(work.workspace).json.error, 'ASDF_CHECKOUT_RECORD');
    const other = newWorkspace(join(ctx.src, 'Other'), 'https://dev.azure.com/contoso/Storage/_git/Other');
    git('-C', other, 'symbolic-ref', 'HEAD', 'refs/heads/user/jdoe/other');
    assert.equal(record(other).json.error, 'ASDF_CHECKOUT_RECORD');
    assert.equal(getItem(201).repo.branch, 'user/jdoe/201-orders');
    assert.equal(getItem(201).repo.worktreePath, work.repo);
  });

  it('does not let two unfinished items share a checkout', () => {
    git('-C', work.workspace, 'switch', '-qc', 'user/jdoe/shared');
    assert.equal(record(work.workspace).code, 0);
    newItem({ id: 202, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Inventory' });
    setItem(202, { repo: { ...getItem(201).repo, branch: 'user/jdoe/202-inventory', worktreePath: null, checkoutMode: null } });
    lockItem(202, 'second-owner');
    assert.equal(record(work.workspace, 'second-owner', '202').json.error, 'ASDF_CHECKOUT_IN_USE');
    setItemStage(201, 'done');
    assert.equal(record(work.workspace, 'second-owner', '202').code, 0);
  });

  it('requires the current operation owner', () => {
    git('-C', work.workspace, 'switch', '-qc', 'user/jdoe/mine');
    assert.equal(record(work.workspace, 'somebody-else').json.error, 'ASDF_LOCK_NOT_OWNER');
  });
});
