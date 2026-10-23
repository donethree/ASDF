import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { it } from 'node:test';
import { normalizeWorktreeRoot } from '../scripts/lib/workspaces.ts';
import { reserveWorktreePath } from '../scripts/lib/worktreePaths.ts';
import { newItem, setItemRepo } from '../scripts/lib/items.ts';
import { getConfig, setConfig } from '../scripts/lib/settings.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { newContext } from './helpers.ts';

it('reserves stable unique worktree roots below 14 characters without creating directories', () => {
  const ctx = newContext();
  const root = process.platform === 'win32' ? join(parse(ctx.context).root, 'w') : '/tmp/w';
  setConfig({ ...getConfig(), worktreeRoot: root });
  const results: string[] = [];
  for (const id of [1, 2]) {
    newItem({ id, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'A very long title that must not be in the path' });
    setItemRepo(id, 'Storage');
    lockItem(id, `owner-${id}`);
    const result = reserveWorktreePath(id, `owner-${id}`);
    assert.ok(result.path.length < 14, result.path);
    assert.equal(existsSync(result.path), false);
    assert.equal(reserveWorktreePath(id, `owner-${id}`).path, result.path);
    results.push(result.path);
  }
  assert.notEqual(results[0], results[1]);
});

it('rejects an overlong or relative parent and asks old configs to run init', () => {
  const ctx = newContext();
  assert.throws(() => normalizeWorktreeRoot(join(ctx.context, 'worktrees')), { code: 'ASDF_WORKTREE_PATH_TOO_LONG' });
  assert.throws(() => normalizeWorktreeRoot('relative'), { code: 'ASDF_WORKTREE_ROOT_INVALID' });
  newItem({ id: 1, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
  setItemRepo(1, 'Storage'); lockItem(1, 'owner');
  assert.throws(() => reserveWorktreePath(1, 'owner'), { code: 'ASDF_WORKTREE_ROOT_REQUIRED' });
});

it('accepts a 13-character candidate and rejects a 14-character candidate', () => {
  const allowed = process.platform === 'win32' ? 'C:\\src' : '/tmp/w';
  const rejected = process.platform === 'win32' ? 'C:\\long' : '/tmp/ww';
  assert.equal(join(normalizeWorktreeRoot(allowed), '123456').length, 13);
  assert.throws(() => normalizeWorktreeRoot(rejected), { code: 'ASDF_WORKTREE_PATH_TOO_LONG' });
});
