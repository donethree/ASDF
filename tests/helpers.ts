// Shared test setup. node --test runs each test file in its own process, so setting ASDF_SETTINGS here
// never leaks between files, and every test gets its own folders under one temp root.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setConfig, setSettings } from '../scripts/lib/settings.ts';
import { getItem, itemPath, setItem, setItemRepo } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = join(REPO, 'scripts', 'asdf.ts');
export const STORAGE_URL = 'https://contoso@dev.azure.com/contoso/Storage/_git/Storage';

const TEMP_ROOT = mkdtempSync(join(tmpdir(), 'asdf-tests-'));
process.on('exit', () => rmSync(TEMP_ROOT, { recursive: true, force: true, maxRetries: 3 }));

let folders = 0;

// A new empty folder for one test.
export function newFolder(name = 'case'): string {
  const path = join(TEMP_ROOT, `${name}-${++folders}`);
  mkdirSync(path, { recursive: true });
  return path;
}

export function git(...args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// A git checkout at `path` whose origin remote is `url`.
export function newWorkspace(path: string, url: string): string {
  mkdirSync(path, { recursive: true });
  git('init', '-q', path);
  git('-C', path, 'remote', 'add', 'origin', url);
  return path;
}

// A git repo with two commits, for the SDD helpers: `base` is the first commit and `head` the second.
export function newRepoWithTwoCommits(): { repo: string; base: string; head: string } {
  const repo = join(newFolder('repo'), 'repo');
  mkdirSync(repo, { recursive: true });
  git('init', '-q', repo);
  git('-C', repo, 'config', 'user.email', 'test@example.com');
  git('-C', repo, 'config', 'user.name', 'Test');
  git('-C', repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git('-C', repo, 'add', '.');
  git('-C', repo, 'commit', '-qm', 'first');
  const base = git('-C', repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  git('-C', repo, 'commit', '-qam', 'second change');
  return { repo, base, head: git('-C', repo, 'rev-parse', 'HEAD') };
}

// A config for user jdoe in org contoso (MCP server ado-contoso, project Storage) with the given workspaces.
export function sampleConfig(workspaces: unknown[], userName: unknown = 'jdoe'): Record<string, unknown> {
  return {
    schemaVersion: 2,
    userName,
    orgs: [{ org: 'contoso', mcpServer: 'ado-contoso', projects: [{ project: 'Storage', watchScopes: [{ kind: 'project', areaPaths: [] }] }] }],
    workspaces,
  };
}

export interface TestContext {
  settings: string;
  context: string;
  src: string;
  workspace: string;
}

// An initialized ASDF install of its own: settings file, context folder, and the sample config with one
// workspace, a checkout of contoso/Storage/_git/Storage. Points ASDF_SETTINGS at it.
export function newContext(): TestContext {
  const root = newFolder('ctx');
  const settings = join(root, 'settings.json');
  const context = join(root, 'ctx');
  const src = join(root, 'src');
  const workspace = newWorkspace(join(src, 'Storage'), STORAGE_URL);
  process.env.ASDF_SETTINGS = settings;
  setSettings(context);
  setConfig(sampleConfig([workspace]));
  return { settings, context, src, workspace };
}

// A real linked worktree bound to an already-created item, without contacting its origin.
export function newItemWorktree(ctx: TestContext, id: number, name = 'Storage'): {
  repo: string; workspace: string; base: string; head: string; owner: string;
} {
  const workspace = ctx.workspace;
  git('-C', workspace, 'config', 'user.email', 'test@example.com');
  git('-C', workspace, 'config', 'user.name', 'Test');
  git('-C', workspace, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(workspace, 'a.txt'), 'one\n');
  git('-C', workspace, 'add', '.');
  git('-C', workspace, 'commit', '-qm', 'first');
  const base = git('-C', workspace, 'rev-parse', 'HEAD');
  writeFileSync(join(workspace, 'a.txt'), 'two\n');
  git('-C', workspace, 'commit', '-qam', 'second change');
  const head = git('-C', workspace, 'rev-parse', 'HEAD');
  setItemRepo(id, name);
  const repo = join(ctx.context, 'worktrees', basename(itemPath(id)!));
  git('-C', workspace, 'worktree', 'add', '-q', '-b', getItem(id).repo.branch, repo);
  setItem(id, { repo: { worktreePath: repo } });
  const owner = `test-owner-${id}`;
  lockItem(id, owner);
  return { repo, workspace, base, head, owner };
}

// Points ASDF_SETTINGS at a settings file that doesn't exist yet: ASDF is not initialized.
export function uninitialized(): string {
  const settings = join(newFolder('settings'), 'settings.json');
  process.env.ASDF_SETTINGS = settings;
  return settings;
}

// Runs the CLI in its own process, as skills do, and parses what it prints.
export function runCli(...args: string[]): { code: number | null; json: any } {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: process.env });
  return { code: result.status, json: JSON.parse(result.stdout) };
}

// A copy of the plugin in a folder whose name has a space, as an install might be.
export function copyPlugin(): string {
  const root = join(newFolder('plugin'), 'plugin root');
  for (const part of ['hooks', 'scripts', 'skills', 'package.json', 'asdf.js']) cpSync(join(REPO, part), join(root, part), { recursive: true });
  return root;
}

// Runs a hook from a plugin copy the way Copilot does: hook input on stdin, ASDF_PLUGIN_ROOT set.
export function runHook(pluginRoot: string, hook: string, input: string, env: Record<string, string> = {}): { code: number | null; out: string } {
  const result = spawnSync(process.execPath, [join(pluginRoot, 'hooks', hook)], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ASDF_PLUGIN_ROOT: pluginRoot, ...env },
  });
  return { code: result.status, out: result.stdout.trim() };
}
