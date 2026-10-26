import { isAbsolute, relative, resolve } from 'node:path';
import { checkoutUser, executionContext, workspaceContext } from './execution.ts';
import { getItems, setItem } from './items.ts';
import { assertItemOwner } from './lock.ts';
import { assertLiveMutation } from './liveWatch.ts';
import { physical, stat } from './localState.ts';
import { branchPrefix, withSettingsGuard } from './settings.ts';
import { AsdfError, fail, git, now, same, stamp } from './util.ts';
import { withItemGuard } from './workerLease.ts';
import { resolveWorkspace } from './workspaces.ts';

// Records the checkout the repository's own README procedure created, or an existing branch to adopt.
// Nothing is switched, reset or moved: ASDF records what is there after checking it can be pushed.
export function recordCheckout(id: number, owner: string, path: string, reason: string) {
  return withSettingsGuard(() => withItemGuard(id, () => {
    const { repo, workspaceReadRoot } = workspaceContext(id, owner);
    assertLiveMutation(id, owner);
    if (typeof reason !== 'string' || !reason.trim()) fail('ASDF_CHECKOUT_RECORD', 'say how this checkout was created');
    if (typeof path !== 'string' || !isAbsolute(path)) fail('ASDF_CHECKOUT_RECORD', 'use the absolute checkout folder');
    let actual;
    try { actual = resolveWorkspace(path); }
    catch (error) { fail('ASDF_CHECKOUT_RECORD', error instanceof AsdfError ? error.message : String(error)); }
    const root = physical(path, 'ASDF_CHECKOUT_RECORD');
    if (!same(actual.org, repo.org) || !same(actual.project, repo.project) || !same(actual.repo, repo.name)) {
      fail('ASDF_CHECKOUT_RECORD', `${path} holds ${actual.org}/${actual.project}/${actual.repo}, not ${repo.org}/${repo.project}/${repo.name}`);
    }
    if (relative(physical(actual.path, 'ASDF_CHECKOUT_RECORD'), root) !== '') fail('ASDF_CHECKOUT_RECORD', `use the checkout root ${actual.path}`);
    const head = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (head.code !== 0) fail('ASDF_CHECKOUT_RECORD', 'check out a branch first; a detached HEAD cannot be pushed');
    const branch = head.out.trim();
    const prefix = branchPrefix();
    if (!prefix || !branch.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) {
      fail('ASDF_CHECKOUT_RECORD', `branch ${branch} must be under ${prefix ?? 'user/<userName>'}/ so the guard lets ASDF push it`);
    }
    const other = checkoutUser(id, root);
    if (other !== null) fail('ASDF_CHECKOUT_IN_USE', `unfinished item ${other} also uses ${path}; finish it before another item works there`);
    const commit = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    assertItemOwner(id, owner);
    setItem(id, { repo: { worktreePath: resolve(path), branch,
      checkoutMode: relative(workspaceReadRoot, root) === '' ? 'source' : 'worktree', sourceFallback: null,
      checkoutRecord: { reason: reason.trim(), recordedAt: stamp(now()), head: commit.code === 0 ? commit.out.trim() : null } } });
    return executionContext(id, owner);
  }));
}

// Moves the configured source checkout onto the item branch when a separate worktree cannot be initialized.
export function sourceFallback(id: number, owner: string, baseRef: string, reason: string) {
  return withSettingsGuard(() => withItemGuard(id, () => {
    const { repo, workspaceReadRoot } = workspaceContext(id, owner);
    assertLiveMutation(id, owner);
    if (repo.checkoutMode === 'source') return executionContext(id, owner);
    if (typeof baseRef !== 'string' || !/^[A-Za-z0-9][\w./-]*$/.test(baseRef) || baseRef.includes('..') || !reason.trim()) {
      fail('ASDF_SOURCE_FALLBACK', 'fallback requires a failure reason and a fetched remote base such as origin/main');
    }
    const prefix = branchPrefix();
    if (!prefix || !repo.branch.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)
      || git(workspaceReadRoot, ['check-ref-format', '--branch', repo.branch]).code !== 0) {
      fail('ASDF_SOURCE_FALLBACK', `fallback needs the item branch under ${prefix ?? 'user/<userName>'}/`);
    }
    const sameRoot = (path: string) => relative(workspaceReadRoot, physical(path, 'ASDF_SOURCE_FALLBACK')) === '';
    if (getItems().some((item) => item.id !== id && item.stage !== 'done' && item.repo?.checkoutMode === 'source'
      && typeof item.repo.clonePath === 'string' && sameRoot(item.repo.clonePath))) {
      fail('ASDF_SOURCE_FALLBACK', 'another unfinished item reserves the source checkout');
    }
    const checked = (root: string, args: string[]) => {
      const result = git(root, args);
      if (result.code !== 0) fail('ASDF_SOURCE_FALLBACK', `git ${args[0]} in ${root}: ${result.error.trim()}`);
      return result.out.trim();
    };
    const clean = (root: string) => {
      if (checked(root, ['status', '--porcelain', '--untracked-files=normal'])) {
        fail('ASDF_SOURCE_FALLBACK', `preserve pending changes in ${root}; source fallback needs clean checkouts`);
      }
      for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
        const path = resolve(root, checked(root, ['rev-parse', '--git-path', marker]));
        if (stat(path)) fail('ASDF_SOURCE_FALLBACK', `finish the Git operation in ${root} before fallback`);
      }
    };
    clean(workspaceReadRoot);
    const base = git(workspaceReadRoot, ['rev-parse', '--verify', '--quiet', `refs/remotes/${baseRef}^{commit}`]);
    if (base.code !== 0) fail('ASDF_SOURCE_FALLBACK', `${baseRef} is not a fetched remote branch; fetch it first`);
    const baseCommit = base.out.trim();
    const previousBranch = checked(workspaceReadRoot, ['branch', '--show-current']);
    const previousHead = checked(workspaceReadRoot, ['rev-parse', 'HEAD']);
    const existing = git(workspaceReadRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${repo.branch}`]);
    if (existing.code !== 0 && existing.code !== 1) fail('ASDF_SOURCE_FALLBACK', existing.error);
    // A fresh failed bootstrap can leave the item branch checked out in its worktree.
    // Keep that directory and its ignored build outputs; release only the clean branch.
    const registrations = checked(workspaceReadRoot, ['worktree', 'list', '--porcelain', '-z']).split('\0\0');
    let detachedWorktree: string | null = null;
    for (const registration of registrations) {
      const fields = registration.split('\0');
      if (!fields.includes(`branch refs/heads/${repo.branch}`)) continue;
      const path = fields.find((field) => field.startsWith('worktree '))?.slice(9);
      if (!path || !repo.worktreePath || sameRoot(path)
        || relative(physical(path, 'ASDF_SOURCE_FALLBACK'), physical(repo.worktreePath, 'ASDF_SOURCE_FALLBACK')) !== '') {
        fail('ASDF_SOURCE_FALLBACK', 'the item branch is checked out outside its recorded worktree');
      }
      const context = executionContext(id, owner);
      clean(context.codeRoot);
      detachedWorktree = context.codeRoot;
    }
    assertItemOwner(id, owner);
    if (detachedWorktree) checked(detachedWorktree, ['switch', '--detach']);
    const switched = git(workspaceReadRoot, existing.code === 0
      ? ['switch', '--no-overwrite-ignore', repo.branch]
      : ['switch', '--no-overwrite-ignore', '-c', repo.branch, `refs/remotes/${baseRef}`]);
    if (switched.code !== 0) {
      assertItemOwner(id, owner);
      if (detachedWorktree) {
        const restored = git(detachedWorktree, ['switch', repo.branch]);
        if (restored.code !== 0) {
          fail('ASDF_SOURCE_FALLBACK', `${switched.error.trim()}; restoring the worktree branch also failed: ${restored.error.trim()}`);
        }
      }
      fail('ASDF_SOURCE_FALLBACK', switched.error.trim());
    }
    assertItemOwner(id, owner);
    setItem(id, { repo: { checkoutMode: 'source', worktreePath: repo.clonePath,
      sourceFallback: { reason, baseRef, baseCommit, previousBranch, previousHead, worktreePath: detachedWorktree } } });
    return executionContext(id, owner);
  }));
}
