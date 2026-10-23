// Verified item-local execution roots. These checks do not grant host permissions or sandbox commands.
import { lstatSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getItem } from './items.ts';
import { isLocked } from './lock.ts';
import { getConfig } from './settings.ts';
import { fail, git, readJson, same, toList } from './util.ts';
import { resolveWorkspace } from './workspaces.ts';
import { artifactPath, inside, physical, stat } from './artifacts.ts';
export { artifactPath } from './artifacts.ts';
import { validateWorktreeLocation } from './worktreePaths.ts';

export interface InstructionFiles {
  root: string[];
  directory: string[];
  scoped: string[];
}

export interface ExecutionContext {
  itemId: number;
  owner: string;
  cli: { executable: string; script: string };
  workItem: { org: string; project: string };
  repository: { org: string; project: string; name: string };
  workspaceReadRoot: string;
  codeRoot: string;
  artifactRoot: string;
  branch: string;
  head: string;
  instructions: InstructionFiles;
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);

function gitOutput(root: string, args: string[]): string {
  const result = git(root, args);
  if (result.code !== 0) fail('ASDF_EXECUTION_CONTEXT', `git ${args[0]} in ${root}: ${result.error.trim()}`);
  return result.out.trimEnd();
}

export function shellWorkingDirectory(path: string): string {
  if (!isAbsolute(path) || (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(path))) {
    fail('ASDF_EXECUTION_CONTEXT', 'the command shell needs an absolute, drive-qualified worktree on Windows; UNC cwd is not supported');
  }
  return path;
}

function instructionPath(codeRoot: string, path: string): string | null {
  if (!stat(path)) return null;
  const actual = physical(path, 'ASDF_EXECUTION_CONTEXT');
  if (!inside(codeRoot, actual) || !lstatSync(actual).isFile()) {
    fail('ASDF_EXECUTION_CONTEXT', `instruction file is not a worktree file: ${path}`);
  }
  return path;
}

function instructionFiles(codeRoot: string): InstructionFiles {
  const roots = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md'];
  const files = new Set([
    ...roots,
    ...gitOutput(codeRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0'),
  ]);
  const scoped = (folder: string) => {
    const info = stat(folder);
    if (!info) return;
    const actual = physical(folder, 'ASDF_EXECUTION_CONTEXT');
    if (!inside(codeRoot, actual) || info.isSymbolicLink() || !info.isDirectory()) {
      fail('ASDF_EXECUTION_CONTEXT', `instruction directory is not a plain worktree directory: ${folder}`);
    }
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) scoped(path);
      else if (entry.isSymbolicLink() && lstatSync(physical(path, 'ASDF_EXECUTION_CONTEXT')).isDirectory()) {
        fail('ASDF_EXECUTION_CONTEXT', `instruction directory link is not supported: ${path}`);
      } else if (entry.name.endsWith('.md')) files.add(relative(codeRoot, path).split(sep).join('/'));
    }
  };
  scoped(join(codeRoot, '.github', 'instructions'));
  scoped(join(codeRoot, '.claude', 'rules'));
  const result: InstructionFiles = { root: [], directory: [], scoped: [] };
  for (const file of [...files].sort()) {
    const kind = roots.includes(file) ? 'root'
      : /(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/.test(file) ? 'directory'
      : /^\.github\/instructions\/.*\.instructions\.md$/.test(file) || /^\.claude\/rules\/.*\.md$/.test(file) ? 'scoped'
      : null;
    if (!kind) continue;
    const path = join(codeRoot, ...file.split('/'));
    const checked = instructionPath(codeRoot, path);
    if (checked) result[kind].push(checked);
  }
  return result;
}

export function executionContext(id: number, owner: string, requestedRepoPath?: string): ExecutionContext {
  const state = getItem(id);
  const artifactRoot = artifactPath(id);
  let lockOwner: unknown;
  try {
    lockOwner = readJson(join(artifactRoot, '.lock')).owner;
  } catch {
    fail('ASDF_LOCK_NOT_OWNER', `item ${id} has no readable operation lock`);
  }
  if (!same(lockOwner, owner) || !isLocked(id)) fail('ASDF_LOCK_NOT_OWNER', `item ${id} is not held by ${owner}`);

  const repo = state.repo;
  if (!repo || !['org', 'project', 'name', 'clonePath', 'worktreePath', 'branch'].every((key) => typeof repo[key] === 'string' && repo[key])) {
    fail('ASDF_EXECUTION_CONTEXT', `item ${id} needs a recorded repository, worktree and branch`);
  }
  if (!isAbsolute(repo.clonePath) || !isAbsolute(repo.worktreePath)) fail('ASDF_EXECUTION_CONTEXT', 'execution roots must be absolute');
  const configured = toList(getConfig()?.workspaces).find((w) =>
    same(w.org, repo.org) && same(w.project, repo.project) && same(w.repo, repo.name)
    && samePath(w.path, repo.clonePath));
  if (!configured) fail('ASDF_EXECUTION_CONTEXT', `item ${id}'s workspace is not configured`);
  const workspaceReadRoot = physical(repo.clonePath, 'ASDF_EXECUTION_CONTEXT');
  const codeRoot = validateWorktreeLocation(id, repo.worktreePath);
  if (requestedRepoPath !== undefined && (!isAbsolute(requestedRepoPath)
    || !samePath(physical(requestedRepoPath, 'ASDF_EXECUTION_CONTEXT'), codeRoot))) {
    fail('ASDF_EXECUTION_CONTEXT', `use item ${id}'s worktree, not ${requestedRepoPath}`);
  }
  for (const root of [workspaceReadRoot, codeRoot]) {
    const actual = resolveWorkspace(root);
    if (!same(actual.org, repo.org) || !same(actual.project, repo.project) || !same(actual.repo, repo.name)
      || !samePath(physical(actual.path, 'ASDF_EXECUTION_CONTEXT'), root)) {
      fail('ASDF_EXECUTION_CONTEXT', `repository identity changed at ${root}`);
    }
  }
  const common = (root: string) => physical(resolve(root, gitOutput(root, ['rev-parse', '--git-common-dir'])), 'ASDF_EXECUTION_CONTEXT');
  if (!samePath(common(workspaceReadRoot), common(codeRoot))) fail('ASDF_EXECUTION_CONTEXT', 'worktree belongs to a different Git repository');
  const registered = gitOutput(workspaceReadRoot, ['worktree', 'list', '--porcelain', '-z']).split('\0')
    .filter((field) => field.startsWith('worktree ')).map((field) => field.slice(9))
    .some((path) => samePath(path, repo.worktreePath) || (stat(path) && samePath(physical(path, 'ASDF_EXECUTION_CONTEXT'), codeRoot)));
  if (!registered) fail('ASDF_EXECUTION_CONTEXT', 'the item worktree is not registered');
  const branch = gitOutput(codeRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch !== repo.branch) fail('ASDF_EXECUTION_CONTEXT', `expected branch ${repo.branch}, found ${branch}`);
  return {
    itemId: id, owner, cli: { executable: process.execPath, script: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'asdf.ts') },
    workItem: { org: state.org, project: state.project },
    repository: { org: repo.org, project: repo.project, name: repo.name },
    workspaceReadRoot, codeRoot: resolve(repo.worktreePath), artifactRoot, branch,
    head: gitOutput(codeRoot, ['rev-parse', '--verify', 'HEAD']),
    instructions: instructionFiles(codeRoot),
  };
}

export function codePath(id: number, owner: string, path: string): { path: string; instructions: InstructionFiles } {
  const context = executionContext(id, owner);
  const codeRoot = physical(context.codeRoot, 'ASDF_EXECUTION_CONTEXT');
  const absolute = resolve(codeRoot, path);
  if (!inside(codeRoot, absolute) && !inside(context.codeRoot, absolute)) {
    fail('ASDF_CODE_PATH', `${path} is outside item ${id}'s worktree`);
  }
  const actual = physical(absolute, 'ASDF_CODE_PATH');
  if (!inside(codeRoot, actual) || relative(codeRoot, actual).split(sep).some((part) => part.toLowerCase() === '.git')) {
    fail('ASDF_CODE_PATH', `${path} is not a code path in item ${id}'s worktree`);
  }
  let existing = actual;
  while (!stat(existing)) existing = dirname(existing);
  if (!lstatSync(existing).isDirectory()) existing = dirname(existing);
  const gitRoot = git(existing, ['rev-parse', '--show-toplevel']);
  if (gitRoot.code !== 0 || !samePath(physical(gitRoot.out.trim(), 'ASDF_CODE_PATH'), codeRoot)) {
    fail('ASDF_CODE_PATH', `${path} belongs to a nested or different repository`);
  }
  const directory = new Set(context.instructions.directory.filter((file) => inside(dirname(file), actual)));
  for (let folder = dirname(actual); inside(codeRoot, folder) && !samePath(folder, codeRoot); folder = dirname(folder)) {
    for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
      const file = instructionPath(codeRoot, join(folder, name));
      if (file) directory.add(file);
    }
  }
  return {
    path: actual,
    instructions: {
      ...context.instructions,
      directory: [...directory].sort(),
    },
  };
}
