import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import * as execution from '../scripts/lib/execution.ts';
import { newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { unlockItem } from '../scripts/lib/lock.ts';
import { reviewPackage, taskDone, taskStart } from '../scripts/lib/sdd.ts';
import { getConfig, setConfig } from '../scripts/lib/settings.ts';
import { CLI, REPO, git, newContext, newFolder, newItemWorktree, newWorkspace, runCli, type TestContext } from './helpers.ts';

describe('item execution context', () => {
  let ctx: TestContext;
  let work: ReturnType<typeof newItemWorktree>;
  beforeEach(() => {
    ctx = newContext();
    newItem({ id: 201, org: 'contoso', project: 'Commerce', kind: 'parent', type: 'User Story', title: 'Orders' });
    work = newItemWorktree(ctx, 201);
    assert.equal(runCli('baseline', '-Id', '201', '-Owner', work.owner, '-BuildCommand', 'echo build passed').code, 0);
  });

  const packet = (owner = 'test-owner-201') => runCli('execution-context', '-Id', '201', '-Owner', owner);
  const pathCheck = (path: string) => runCli('code-path', '-Id', '201', '-Owner', 'test-owner-201', '-Path', path);

  it('binds a worker to its worktree even when launched from a different project', () => {
    const launcher = newFolder('launcher');
    const result = spawnSync(process.execPath, [CLI, 'execution-context', '-Id', '201', '-Owner', work.owner], {
      cwd: launcher, env: process.env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout);
    const context = JSON.parse(result.stdout);
    assert.deepEqual(context.repository, { org: 'contoso', project: 'Storage', name: 'Storage' });
    assert.equal(context.itemId, 201);
    assert.equal(context.owner, work.owner);
    assert.deepEqual(context.cli, { executable: process.execPath, script: CLI });
    assert.equal(context.branch, 'user/jdoe/201-orders');
    assert.equal(context.codeRoot, work.repo);
    assert.equal(context.workspaceReadRoot, realpathSync.native(work.workspace));
    assert.equal(context.artifactRoot, realpathSync.native(join(ctx.context, '201-orders')));
    assert.notEqual(context.codeRoot, launcher);
  });

  it('lists target-repo instructions and selects directory instructions for the edited path', () => {
    mkdirSync(join(work.repo, '.github', 'instructions'), { recursive: true });
    mkdirSync(join(work.repo, 'src', 'billing'), { recursive: true });
    mkdirSync(join(work.repo, 'src', 'other'), { recursive: true });
    writeFileSync(join(work.repo, 'AGENTS.md'), 'Root rules');
    writeFileSync(join(work.repo, '.github', 'copilot-instructions.md'), 'Repo rules');
    writeFileSync(join(work.repo, '.github', 'instructions', 'billing.instructions.md'), '---\napplyTo: "src/billing/**"\n---\nBilling rules');
    writeFileSync(join(work.repo, 'src', 'billing', 'AGENTS.md'), 'Billing directory rules');
    writeFileSync(join(work.repo, 'src', 'other', 'AGENTS.md'), 'Other directory rules');
    const context = packet();
    assert.equal(context.code, 0);
    assert.deepEqual(context.json.instructions.root, [
      join(realpathSync.native(work.repo), '.github', 'copilot-instructions.md'),
      join(realpathSync.native(work.repo), 'AGENTS.md'),
    ]);
    assert.deepEqual(context.json.instructions.scoped, [join(realpathSync.native(work.repo), '.github', 'instructions', 'billing.instructions.md')]);
    const target = pathCheck(join('src', 'billing', 'export.ts'));
    assert.equal(target.code, 0);
    assert.equal(target.json.path, join(realpathSync.native(work.repo), 'src', 'billing', 'export.ts'));
    assert.deepEqual(target.json.instructions.directory, [join(realpathSync.native(work.repo), 'src', 'billing', 'AGENTS.md')]);
  });

  it('finds applicable local instructions even when Git ignores them', () => {
    mkdirSync(join(work.repo, '.github', 'instructions'), { recursive: true });
    mkdirSync(join(work.repo, 'src', 'billing'), { recursive: true });
    writeFileSync(join(work.repo, '.gitignore'), 'src/billing/AGENTS.md\n.github/instructions/local.instructions.md\n');
    writeFileSync(join(work.repo, 'src', 'billing', 'AGENTS.md'), 'Local directory rules');
    writeFileSync(join(work.repo, '.github', 'instructions', 'local.instructions.md'), '---\napplyTo: "src/billing/**"\n---\nLocal rules');
    const result = pathCheck(join('src', 'billing', 'export.ts'));
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.instructions.directory, [join(realpathSync.native(work.repo), 'src', 'billing', 'AGENTS.md')]);
    assert.deepEqual(result.json.instructions.scoped, [join(realpathSync.native(work.repo), '.github', 'instructions', 'local.instructions.md')]);
  });

  it('rejects a changed branch instead of silently switching it', () => {
    git('-C', work.repo, 'switch', '-qc', 'wrong-branch');
    assert.equal(packet().json.error, 'ASDF_EXECUTION_CONTEXT');
    assert.equal(git('-C', work.repo, 'branch', '--show-current'), 'wrong-branch');
  });

  it('rejects a detached worktree', () => {
    git('-C', work.repo, 'checkout', '-q', '--detach');
    assert.equal(packet().json.error, 'ASDF_EXECUTION_CONTEXT');
  });

  it('rejects a changed origin identity', () => {
    git('-C', work.workspace, 'remote', 'set-url', 'origin', 'https://dev.azure.com/contoso/Other/_git/Other');
    assert.equal(packet().json.error, 'ASDF_EXECUTION_CONTEXT');
  });

  it('keeps verifying an in-flight item after its workspace is removed from configuration', () => {
    const other = newWorkspace(join(ctx.src, 'Other'), 'https://dev.azure.com/contoso/Storage/_git/Other');
    setConfig({ ...getConfig(), workspaces: [other] });
    assert.equal(packet().code, 0, JSON.stringify(packet().json));
  });

  it('rejects missing and foreign lock ownership', () => {
    assert.equal(packet('somebody-else').json.error, 'ASDF_LOCK_NOT_OWNER');
    unlockItem(201, work.owner);
    assert.equal(packet().json.error, 'ASDF_LOCK_NOT_OWNER');
  });

  it('rejects the original checkout while it is on another branch', () => {
    setItem(201, { repo: { worktreePath: work.workspace } });
    assert.equal(packet().json.error, 'ASDF_EXECUTION_CONTEXT');
  });
  it('accepts its registered worktree outside the ASDF context folder', () => {
    const outside = join(newFolder('external-worktree'), 'w');
    git('-C', work.workspace, 'worktree', 'move', work.repo, outside);
    setItem(201, { repo: { worktreePath: outside } });
    assert.equal(runCli('baseline', '-Id', '201', '-Owner', work.owner, '-BuildCommand', 'echo build passed').code, 0);
    const result = packet();
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.codeRoot, outside);
    assert.equal(pathCheck(join(outside, 'new.ts')).code, 0);
    assert.equal(pathCheck(join(work.workspace, 'new.ts')).json.error, 'ASDF_CODE_PATH');
  });
  it('does not depend on historical worktree drives being available', { skip: process.platform !== 'win32' }, (t) => {
    const drive = 'ZYXWVUTSRQPONMLKJIHGFED'.split('').map(c => `${c}:\\`).find(p => !existsSync(p));
    if (!drive) { t.skip('no absent drive available'); return; }
    newItem({ id: 202, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Historical' });
    setItem(202, { repo: { worktreePath: join(drive, 'w', 'abc123') } });
    setItemStage(202, 'done');
    assert.equal(packet().code, 0);
    setItemStage(202, 'new');
    assert.equal(packet().code, 0);
  });

  it('accepts a separate clone of the same repository on the item branch', () => {
    git('-C', work.workspace, 'worktree', 'remove', work.repo);
    git('clone', '-q', work.workspace, work.repo);
    git('-C', work.repo, 'remote', 'set-url', 'origin', 'https://dev.azure.com/contoso/Storage/_git/Storage');
    git('-C', work.repo, 'switch', '-q', 'user/jdoe/201-orders');
    const result = packet();
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.codeRoot, work.repo);
  });

  it('rejects an empty checkout placed at the expected worktree path', () => {
    git('-C', work.workspace, 'worktree', 'remove', work.repo);
    newWorkspace(work.repo, 'https://dev.azure.com/contoso/Storage/_git/Storage');
    git('-C', work.repo, 'symbolic-ref', 'HEAD', 'refs/heads/user/jdoe/201-orders');
    assert.equal(packet().json.error, 'ASDF_EXECUTION_CONTEXT');
  });

  it('does not adopt another item worktree', () => {
    const other = newWorkspace(join(ctx.src, 'Inventory'), 'https://dev.azure.com/contoso/Storage/_git/Inventory');
    setConfig({ ...getConfig(), workspaces: [ctx.workspace, other] });
    newItem({ id: 202, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Inventory' });
    const second = newItemWorktree({ ...ctx, workspace: other }, 202, 'Inventory');
    assert.equal(pathCheck(join(second.repo, 'inventory.ts')).json.error, 'ASDF_CODE_PATH');
    setItem(201, { repo: { worktreePath: second.repo } });
    assert.equal(packet().json.error, 'ASDF_EXECUTION_CONTEXT');
  });

  it('rejects an item-root junction pointing at another item even if branch state was also changed', () => {
    newItem({ id: 202, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Inventory' });
    const second = newItemWorktree(ctx, 202);
    git('-C', work.workspace, 'worktree', 'remove', work.repo);
    symlinkSync(second.repo, work.repo, process.platform === 'win32' ? 'junction' : 'dir');
    setItem(201, { repo: { branch: 'user/jdoe/202-inventory' } });
    assert.equal(packet().json.error, 'ASDF_EXECUTION_CONTEXT');
  });

  it('rejects code paths in the launcher, workspace, artifacts and parent directories', () => {
    for (const path of [
      join(newFolder('launcher'), 'file.ts'), join(work.workspace, 'file.ts'),
      join(ctx.context, '201-orders', 'file.ts'), join('..', 'escape.ts'), '.git',
    ]) assert.equal(pathCheck(path).json.error, 'ASDF_CODE_PATH', path);
  });

  it('rejects a directory link escaping to the original checkout', () => {
    symlinkSync(work.workspace, join(work.repo, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(pathCheck(join('linked', 'new.ts')).json.error, 'ASDF_CODE_PATH');
  });

  it('rejects edits in a nested repository', () => {
    const nested = join(work.repo, 'nested');
    git('init', '-q', nested);
    assert.equal(pathCheck(join('nested', 'new.ts')).json.error, 'ASDF_CODE_PATH');
  });

  it('rejects a test command in the wrong repo before executing it', () => {
    assert.throws(() => taskDone(201, 1, work.base, work.workspace, 'echo unsafe > unexpected.txt', work.owner), {
      code: 'ASDF_EXECUTION_CONTEXT',
    });
    assert.equal(existsSync(join(work.workspace, 'unexpected.txt')), false);
  });

  it('checks context before creating task briefs or review packages', () => {
    const plan = join(ctx.context, '201-orders', 'plan.md');
    writeFileSync(plan, '### Task 1: X\nDo it\n');
    assert.throws(() => taskStart(201, plan, 1, work.workspace, work.owner), { code: 'ASDF_EXECUTION_CONTEXT' });
    assert.throws(() => reviewPackage(201, work.workspace, work.base, work.head, work.owner), { code: 'ASDF_EXECUTION_CONTEXT' });
    assert.equal(existsSync(join(ctx.context, '201-orders', 'sdd')), false);
  });

  it('rejects another item or launcher plan rather than generating a brief from it', () => {
    const plan = join(newFolder('foreign-plan'), 'plan.md');
    writeFileSync(plan, '### Task 1: Wrong item\nNot our work\n');
    assert.throws(() => taskStart(201, plan, 1, work.repo, work.owner), { code: 'ASDF_ARTIFACT_PATH' });
    assert.equal(existsSync(join(ctx.context, '201-orders', 'sdd')), false);
  });

  it('does not write execution artifacts through a link outside the item folder', () => {
    const outside = newFolder('outside-artifacts');
    symlinkSync(outside, join(ctx.context, '201-orders', 'sdd'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => taskDone(201, 1, work.base, work.repo, 'echo unsafe > unexpected.txt', work.owner), {
      code: 'ASDF_ARTIFACT_PATH',
    });
    assert.equal(existsSync(join(outside, 'task-1-test.log')), false);
    assert.equal(existsSync(join(work.repo, 'unexpected.txt')), false);
  });

  it('runs valid test commands in the bound worktree, not the caller cwd', () => {
    const result = taskDone(201, 1, work.base, work.repo, 'echo in worktree > marker.txt', work.owner);
    assert.equal(result.recorded, true);
    assert.match(readFileSync(join(work.repo, 'marker.txt'), 'utf8'), /in worktree/);
    assert.equal(existsSync(join(work.workspace, 'marker.txt')), false);
  });

  it('records the controller BASE from the item worktree rather than the original checkout', () => {
    writeFileSync(join(work.workspace, 'a.txt'), 'unrelated user work\n');
    git('-C', work.workspace, 'commit', '-qam', 'user change');
    const skill = readFileSync(join(REPO, 'skills', 'subagent-driven-development', 'SKILL.md'), 'utf8');
    const snippet = /Record BASE \(`([^`]+)`\)/.exec(skill)?.[1];
    assert.ok(snippet, 'the controller supplies an executable BASE command');
    const result = spawnSync(snippet.replace('<codeRoot>', work.repo), { cwd: work.workspace, shell: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), work.head);
  });

  it('does not let the Windows command shell fall back from a UNC cwd', { skip: process.platform !== 'win32' }, () => {
    assert.throws(() => execution.shellWorkingDirectory('\\\\server\\share\\item'), { code: 'ASDF_EXECUTION_CONTEXT' });
    assert.equal(execution.shellWorkingDirectory(work.repo), work.repo);
  });
});
