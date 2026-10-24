import { relative, resolve } from 'node:path';
import { executionContext, workspaceContext } from './execution.ts';
import { getItems, setItem } from './items.ts';
import { assertItemOwner } from './lock.ts';
import { assertLiveMutation } from './liveWatch.ts';
import { physical, stat } from './localState.ts';
import { branchPrefix, withSettingsGuard } from './settings.ts';
import { fail, git } from './util.ts';
import { withItemGuard } from './workerLease.ts';

// Explicitly registered fallback, never an implicit replacement for a missing worktree.
export function sourceFallback(id: number, owner: string, baseRef: string, reason: string) {
  return withSettingsGuard(() => withItemGuard(id, () => {
    const { repo, workspaceReadRoot } = workspaceContext(id, owner);
    assertLiveMutation(id, owner);
    if (repo.checkoutMode === 'source') return executionContext(id, owner);
    if (!/^origin\/(?:main|master)$/.test(baseRef) || !reason.trim()) {
      fail('ASDF_SOURCE_FALLBACK', 'fallback requires a failure reason and a fetched origin/main or origin/master');
    }
    const prefix = branchPrefix();
    if (!prefix || !repo.branch.startsWith(`${prefix}/${id}-`)
      || git(workspaceReadRoot, ['check-ref-format', '--branch', repo.branch]).code !== 0) {
      fail('ASDF_SOURCE_FALLBACK', 'fallback must use the item feature branch');
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
    const baseCommit = checked(workspaceReadRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`]);
    const previousBranch = checked(workspaceReadRoot, ['branch', '--show-current']);
    const previousHead = checked(workspaceReadRoot, ['rev-parse', 'HEAD']);
    const existing = git(workspaceReadRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${repo.branch}`]);
    if (existing.code !== 0 && existing.code !== 1) fail('ASDF_SOURCE_FALLBACK', existing.error);
    if (existing.code === 0 && checked(workspaceReadRoot, ['rev-parse', `refs/heads/${repo.branch}`]) !== baseCommit) {
      fail('ASDF_SOURCE_FALLBACK', 'the item branch already contains work or uses a different base; do not reset it');
    }
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
      : ['switch', '--no-overwrite-ignore', '-c', repo.branch, baseRef]);
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
