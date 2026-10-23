import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { getItem, getItems, setItem } from './items.ts';
import { assertItemOwner } from './lock.ts';
import { assertLiveMutation } from './liveWatch.ts';
import { physical, inside, stat } from './localState.ts';
import { contextPath, getConfig, validateContextPath, withSettingsGuard } from './settings.ts';
import { withItemGuard } from './workerLease.ts';
import { MAX_WORKTREE_PATH_LENGTH, normalizeWorktreeRoot } from './workspaces.ts';
import { fail, toList } from './util.ts';

// Location is chosen independently of artifact storage. It must not overlap
// protected checkouts, item artifacts or another active item's worktree.
export function validateWorktreeLocation(id: number, path: string): string {
  if (!isAbsolute(path)) fail('ASDF_EXECUTION_CONTEXT', 'worktree path must be absolute');
  const root = physical(path, 'ASDF_EXECUTION_CONTEXT');
  const overlaps = (other: string) => inside(other, root) || inside(root, other);
  const context = physical(contextPath(), 'ASDF_EXECUTION_CONTEXT');
  if (dirname(root) === root || inside(root, context)) {
    fail('ASDF_EXECUTION_CONTEXT', 'worktree cannot contain the context folder or be a filesystem root');
  }
  for (const workspace of toList(getConfig()?.workspaces)) {
    if (overlaps(physical(workspace.path, 'ASDF_EXECUTION_CONTEXT'))) fail('ASDF_EXECUTION_CONTEXT', 'worktree overlaps a configured source checkout');
  }
  for (const entry of readdirSync(context, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d+-/.test(entry.name) && overlaps(join(context, entry.name))) {
      fail('ASDF_EXECUTION_CONTEXT', 'worktree overlaps item artifacts');
    }
  }
  for (const item of getItems()) {
    if (item.id === id || item.stage === 'done' || !item.repo?.worktreePath) continue;
    const path = item.repo.worktreePath;
    const other = stat(parse(path).root) ? physical(path, 'ASDF_EXECUTION_CONTEXT') : resolve(path);
    if (overlaps(other)) fail('ASDF_EXECUTION_CONTEXT', 'worktree overlaps another item worktree');
  }
  return root;
}

export function reserveWorktreePath(id: number, owner: string): { path: string; reused: boolean; maxLength: number } {
  return withSettingsGuard(() => withItemGuard(id, () => {
    assertItemOwner(id, owner);
    assertLiveMutation(id, owner);
    const item = getItem(id);
    if (item.kind === 'feature' || !item.repo?.clonePath || !item.repo?.branch) fail('ASDF_EXECUTION_CONTEXT', 'choose a code repository and recorded branch before reserving a worktree');
    if (item.repo.worktreePath) {
      validateWorktreeLocation(id, item.repo.worktreePath);
      if (!existsSync(item.repo.worktreePath) && item.repo.worktreePath.length > MAX_WORKTREE_PATH_LENGTH) {
        fail('ASDF_WORKTREE_PATH_TOO_LONG', 'the missing recorded worktree is too long to recreate; explicitly choose a short path before retrying');
      }
      return { path: item.repo.worktreePath, reused: true, maxLength: MAX_WORKTREE_PATH_LENGTH };
    }
    const configured = getConfig()?.worktreeRoot;
    if (!configured) fail('ASDF_WORKTREE_ROOT_REQUIRED', 'run node "<plugin root>\\asdf.js" --init manually and choose a short worktree parent folder');
    const parent = validateContextPath(normalizeWorktreeRoot(configured));
    for (let attempt = 0; attempt < 20; attempt++) {
      const path = join(parent, randomBytes(3).toString('hex'));
      if (existsSync(path) || getItems().some(i => i.repo?.worktreePath?.toLowerCase() === path.toLowerCase())) continue;
      validateWorktreeLocation(id, path);
      setItem(id, { repo: { worktreePath: path } });
      return { path, reused: false, maxLength: MAX_WORKTREE_PATH_LENGTH };
    }
    fail('ASDF_WORKTREE_PATH_UNAVAILABLE', 'could not reserve an unused short worktree path');
  }));
}
