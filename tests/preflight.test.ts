import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { getItem, itemPath, newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem, unlockItem } from '../scripts/lib/lock.ts';
import { git, newContext, newItemWorktree, runCli, type TestContext } from './helpers.ts';

describe('implementation preflight', () => {
  let ctx: TestContext;
  let work: ReturnType<typeof newItemWorktree>;
  beforeEach(() => {
    ctx = newContext();
    newItem({ id: 201, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Orders' });
    work = newItemWorktree(ctx, 201);
    setItem(201, { route: 'small' });
    setItemStage(201, 'implementing');
  });
  const command = (name: string, ...args: string[]) => runCli(name, '-Id', '201', '-Owner', work.owner, ...args);
  const baseline = (build = 'echo build passed', test = 'echo tests passed') =>
    command('baseline', '-BuildCommand', build, '-TestCommand', test);
  const fallback = (base = 'origin/main') =>
    command('source-fallback', '-BaseRef', base, '-Reason', 'repository bootstrap does not support linked worktrees');
  const remoteBase = (branch = 'main') => {
    git('-C', work.workspace, 'update-ref', `refs/remotes/origin/${branch}`, work.head);
  };

  it('blocks implementation edits and task dispatch until a baseline build passes', () => {
    writeFileSync(join(itemPath(201)!, 'plan.md'), '### Task 1: Orders\nImplement orders\n');
    assert.equal(command('code-path', '-Path', 'orders.ts').json.error, 'ASDF_BASELINE_REQUIRED');
    assert.equal(command('task-start', '-PlanPath', join(itemPath(201)!, 'plan.md'), '-TaskNumber', '1', '-RepoPath', work.repo).json.error, 'ASDF_BASELINE_REQUIRED');
    const result = baseline();
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.recorded, true);
    assert.equal(command('code-path', '-Path', 'orders.ts').code, 0);
    assert.equal(command('task-start', '-PlanPath', join(itemPath(201)!, 'plan.md'), '-TaskNumber', '1', '-RepoPath', work.repo).code, 0);
  });

  it('runs build before tests in codeRoot and keeps command output as evidence', () => {
    const result = baseline('echo built > built.txt', process.platform === 'win32' ? 'type built.txt' : 'cat built.txt');
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(existsSync(join(work.repo, 'built.txt')), true);
    assert.equal(existsSync(join(work.workspace, 'built.txt')), false);
    const record = JSON.parse(readFileSync(join(itemPath(201)!, 'baseline.json'), 'utf8'));
    assert.equal(record.owner, work.owner);
    assert.equal(record.head, work.head);
    assert.equal(record.codeRoot, work.repo);
    assert.equal(record.passed, true);
    assert.match(readFileSync(record.log, 'utf8'), /built/);
  });

  it('invalidates an earlier pass when a build fails and does not run tests', () => {
    assert.equal(baseline().code, 0);
    const failed = baseline('exit 7', 'echo should not run > unexpected.txt');
    assert.equal(failed.code, 7, JSON.stringify(failed.json));
    assert.equal(failed.json.recorded, false);
    assert.equal(failed.json.exitCode, 7);
    assert.equal(existsSync(join(work.repo, 'unexpected.txt')), false);
    assert.equal(command('code-path', '-Path', 'orders.ts').json.error, 'ASDF_BASELINE_REQUIRED');
  });

  it('requires passing baseline tests when a test command is supplied', () => {
    const failed = baseline('echo build passed', 'exit 8');
    assert.equal(failed.code, 8, JSON.stringify(failed.json));
    assert.equal(failed.json.recorded, false);
    assert.equal(command('code-path', '-Path', 'orders.ts').json.error, 'ASDF_BASELINE_REQUIRED');
  });

  it('does not prevent PR repairs from editing the failing implementation', () => {
    setItemStage(201, 'pr-feedback');
    assert.equal(command('code-path', '-Path', 'orders.ts').code, 0);
  });

  it('does not reuse evidence from an earlier operation owner', () => {
    assert.equal(baseline().code, 0);
    unlockItem(201, work.owner);
    work.owner = 'resumed-operation';
    lockItem(201, work.owner);
    assert.equal(command('code-path', '-Path', 'orders.ts').json.error, 'ASDF_BASELINE_REQUIRED');
  });

  it('keeps a passing baseline valid for descendant implementation commits', () => {
    assert.equal(baseline().code, 0);
    writeFileSync(join(work.repo, 'a.txt'), 'implementation\n');
    git('-C', work.repo, 'commit', '-qam', 'implementation');
    assert.equal(command('code-path', '-Path', 'orders.ts').code, 0);
  });

  it('falls back after worktree creation fails, starting a new branch at remote main rather than local HEAD', () => {
    remoteBase();
    git('-C', work.workspace, 'worktree', 'remove', work.repo);
    git('-C', work.workspace, 'branch', '-D', getItem(201).repo.branch);
    writeFileSync(join(work.workspace, 'a.txt'), 'unrelated local commit\n');
    git('-C', work.workspace, 'commit', '-qam', 'local source commit');
    const previousBranch = git('-C', work.workspace, 'branch', '--show-current');
    const previousHead = git('-C', work.workspace, 'rev-parse', 'HEAD');
    const result = fallback();
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.codeRoot, work.workspace);
    assert.equal(result.json.checkoutMode, 'source');
    assert.equal(git('-C', work.workspace, 'rev-parse', 'HEAD'), work.head);
    assert.equal(git('-C', work.workspace, 'rev-parse', previousBranch), previousHead);
    assert.equal(git('-C', work.workspace, 'branch', '--show-current'), 'user/jdoe/201-orders');
    assert.equal(getItem(201).repo.sourceFallback.previousBranch, previousBranch);
    assert.equal(command('execution-context').code, 0);
    assert.equal(command('code-path', '-Path', 'orders.ts').json.error, 'ASDF_BASELINE_REQUIRED');
    assert.equal(baseline().code, 0);
    assert.equal(command('code-path', '-Path', 'orders.ts').code, 0);
  });

  it('falls back after fresh worktree bootstrap fails without deleting the worktree', () => {
    remoteBase('master');
    assert.equal(baseline().code, 0);
    const result = fallback('origin/master');
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(existsSync(work.repo), true);
    assert.equal(git('-C', work.repo, 'rev-parse', 'HEAD'), work.head);
    assert.equal(git('-C', work.workspace, 'branch', '--show-current'), 'user/jdoe/201-orders');
    assert.equal(command('execution-context').code, 0);
    assert.equal(command('code-path', '-Path', 'orders.ts').json.error, 'ASDF_BASELINE_REQUIRED');
    assert.equal(baseline().code, 0);
    assert.equal(command('code-path', '-Path', 'orders.ts').code, 0);
  });

  it('preserves dirty source files rather than switching its branch', () => {
    remoteBase();
    writeFileSync(join(work.workspace, 'personal.txt'), 'user work');
    const branch = git('-C', work.workspace, 'branch', '--show-current');
    assert.equal(fallback().json.error, 'ASDF_SOURCE_FALLBACK');
    assert.equal(git('-C', work.workspace, 'branch', '--show-current'), branch);
    assert.equal(readFileSync(join(work.workspace, 'personal.txt'), 'utf8'), 'user work');
  });

  it('does not overwrite ignored source files when switching to the remote-based feature branch', () => {
    remoteBase();
    git('-C', work.workspace, 'rm', 'a.txt');
    writeFileSync(join(work.workspace, '.gitignore'), 'a.txt\n');
    git('-C', work.workspace, 'add', '.gitignore');
    git('-C', work.workspace, 'commit', '-qm', 'local source layout');
    writeFileSync(join(work.workspace, 'a.txt'), 'ignored personal file\n');
    const branch = git('-C', work.workspace, 'branch', '--show-current');
    assert.equal(fallback().json.error, 'ASDF_SOURCE_FALLBACK');
    assert.equal(readFileSync(join(work.workspace, 'a.txt'), 'utf8'), 'ignored personal file\n');
    assert.equal(git('-C', work.workspace, 'branch', '--show-current'), branch);
    assert.equal(git('-C', work.repo, 'branch', '--show-current'), 'user/jdoe/201-orders');
  });

  it('preserves dirty or already-implemented worktrees rather than restarting them', () => {
    remoteBase();
    writeFileSync(join(work.repo, 'a.txt'), 'implementation\n');
    assert.equal(fallback().json.error, 'ASDF_SOURCE_FALLBACK');
    git('-C', work.repo, 'commit', '-qam', 'implementation');
    assert.equal(fallback().json.error, 'ASDF_SOURCE_FALLBACK');
    assert.equal(git('-C', work.repo, 'branch', '--show-current'), 'user/jdoe/201-orders');
  });

  it('rejects stale or unsupported fallback targets and wrong owners', () => {
    assert.equal(fallback().json.error, 'ASDF_SOURCE_FALLBACK');
    remoteBase('develop');
    assert.equal(fallback('origin/develop').json.error, 'ASDF_SOURCE_FALLBACK');
    work.owner = 'not-the-owner';
    assert.equal(fallback().json.error, 'ASDF_LOCK_NOT_OWNER');
  });

  it('does not let a second item take over a reserved source checkout', () => {
    remoteBase();
    assert.equal(fallback().code, 0);
    newItem({ id: 202, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Inventory' });
    setItem(202, { repo: { ...getItem(201).repo, branch: 'user/jdoe/202-inventory', checkoutMode: null, sourceFallback: null, worktreePath: null } });
    lockItem(202, 'second-owner');
    const result = runCli('source-fallback', '-Id', '202', '-Owner', 'second-owner', '-BaseRef', 'origin/main', '-Reason', 'bootstrap failed');
    assert.equal(result.json.error, 'ASDF_SOURCE_FALLBACK');
    assert.equal(git('-C', work.workspace, 'branch', '--show-current'), 'user/jdoe/201-orders');
  });
});
