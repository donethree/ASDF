// Settings (where asdf-context lives) and asdf.config.json (orgs, projects, workspaces, user name).
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsdfError, fail, isObject, prop, readJson, same, toList, writeJson, type Json } from './util.ts';
import { resolveWorkspace } from './workspaces.ts';
import { DEFAULT_TYPES, normalizeConfig, type AsdfConfig } from './watchScopes.ts';
import { withDirectoryGuard, physical } from './localState.ts';

const TYPE_LISTS = ['parent', 'task', 'feature'];

export function settingsPath(): string {
  return process.env.ASDF_SETTINGS || join(homedir(), '.copilot', 'asdf', 'settings.json');
}

export function withSettingsGuard<T>(action: () => T, file = settingsPath()): T {
  return withDirectoryGuard(`${physical(file, 'ASDF_SETTINGS_INVALID')}.setup-guard`, action);
}

export function getSettings(): Json {
  const path = settingsPath();
  if (!existsSync(path)) return null;
  let settings: Json;
  try {
    settings = readJson(path);
  } catch {
    fail('ASDF_SETTINGS_INVALID', `${path} is not valid JSON`);
  }
  return prop(settings, 'contextPath') ? settings : null;
}

// A full path with a root: a drive or share on Windows (not "\x" or "C:x"), "/..." elsewhere.
function isFullyQualified(path: string): boolean {
  if (process.platform === 'win32') return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]/.test(path);
  return isAbsolute(path);
}

export function validateContextPath(contextPath: string): string {
  if (!isFullyQualified(contextPath)) fail('ASDF_CONTEXT_NOT_ABSOLUTE', contextPath);
  const full = resolve(contextPath);
  for (let dir = full; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) fail('ASDF_CONTEXT_INSIDE_REPO', `${full} is inside the git work tree ${dir}`);
    if (dirname(dir) === dir) break;
  }
  let existing = full;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  for (let dir = realpathSync.native(existing); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) fail('ASDF_CONTEXT_INSIDE_REPO', `${full} resolves inside the git work tree ${dir}`);
    if (dirname(dir) === dir) break;
  }
  return full;
}

export function setSettings(contextPath: string): Json {
  return withSettingsGuard(() => saveSettings(contextPath));
}
function saveSettings(contextPath: string): Json {
  const full = validateContextPath(contextPath);
  mkdirSync(full, { recursive: true });
  const settings = { schemaVersion: 1, contextPath: full };
  writeJson(settingsPath(), settings);
  return settings;
}

export function contextPath(): string {
  const settings = getSettings();
  if (!settings) fail('ASDF_NOT_INITIALIZED', `run node "${resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'asdf.js')}" --init manually`);
  return settings.contextPath;
}

export function memoryPath(org: string, project: string, repo: string): string {
  const segment = (value: string) => {
    if (!value.trim()) fail('ASDF_BAD_ARGUMENT', 'memory identity needs an org, project and repo');
    return encodeURIComponent(value.toLowerCase()).replace(/\./g, '%2E');
  };
  return join(contextPath(), 'memory', `org-${segment(org)}`, `project-${segment(project)}`, `repo-${segment(repo)}.md`);
}

export function getConfig(): Json {
  const path = join(contextPath(), 'asdf.config.json');
  if (!existsSync(path)) return null;
  return normalizeConfig(readJson(path));
}

// ASDF's branches are user/<userName>/<id>-<slug>. Null until init has saved a user name.
export function branchPrefix(): string | null {
  if (!getSettings()) return null;
  const name = prop(getConfig(), 'userName');
  return name ? `user/${name}` : null;
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// Every problem with a config, in a fixed order; empty when it is valid.
export function checkConfig(config: Json): string[] {
  const errors: string[] = [];
  if (prop(config, 'schemaVersion') !== 2) errors.push('schemaVersion must be 2');
  const user = String(prop(config, 'userName') ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(user) || /\.\.|\.lock$|\.$/i.test(user)) {
    errors.push('userName must be set to a name that is safe in a branch name: letters, digits, dots, dashes and underscores');
  }
  const orgs = toList(prop(config, 'orgs'));
  if (orgs.length === 0) errors.push('orgs must list at least one org');
  for (const org of orgs) {
    const name = prop(org, 'org');
    if (!name) errors.push('every org needs an org name');
    if (!prop(org, 'mcpServer')) errors.push(`org '${name ?? ''}' needs an mcpServer`);
    const projects = toList(prop(org, 'projects'));
    if (projects.length === 0) errors.push(`org '${name ?? ''}' needs at least one project`);
    for (const project of projects) {
      if (!prop(project, 'project')) errors.push(`org '${name ?? ''}' has a project without a name`);
    }
  }
  const workspaces = toList(prop(config, 'workspaces'));
  if (workspaces.length === 0) errors.push('workspaces must list at least one local checkout');
  const orgNames = orgs.map((org) => prop(org, 'org'));
  const seen = new Map<string, string>();
  for (const workspace of workspaces) {
    const path = prop(workspace, 'path');
    const org = prop(workspace, 'org');
    const repo = prop(workspace, 'repo');
    if (!path || !org || !repo) {
      errors.push(`workspace '${JSON.stringify(workspace)}' needs a path and the org and repo it holds`);
      continue;
    }
    if (!orgNames.some((name) => same(name, org))) {
      errors.push(`workspace ${path} holds a repo in org '${org}', which isn't one of the configured orgs`);
    }
    const key = JSON.stringify([org, prop(workspace, 'project'), repo].map((v) => String(v).toLowerCase()));
    const other = seen.get(key);
    if (other !== undefined) errors.push(`repo ${repo} is in two workspaces: ${other} and ${path}`);
    else seen.set(key, path);
  }
  for (const name of ['lockStaleMinutes', 'maxQuestionsPerRound']) {
    const value = prop(config, name);
    if (value !== null && value !== undefined && !isPositiveNumber(value)) errors.push(`${name} must be a positive number`);
  }
  const types = prop(config, 'workItemTypes');
  if (types !== null && types !== undefined) {
    if (!Array.isArray(prop(types, 'feature'))) errors.push('workItemTypes.feature must be an array');
    for (const kind of ['parent', 'task']) {
      if (toList(prop(types, kind)).length === 0) errors.push(`workItemTypes.${kind} must list at least one type`);
    }
    const listOf = new Map<string, string>();
    for (const kind of TYPE_LISTS) {
      for (const type of toList(prop(types, kind))) {
        const key = String(type).toLowerCase();
        const first = listOf.get(key);
        if (first === undefined) listOf.set(key, kind);
        else if (first !== kind) errors.push(`work item type '${type}' is in more than one workItemTypes list`);
      }
    }
  }
  return errors;
}

// Saves the config with its defaults filled in. Workspaces arrive as paths (or entries with a path) and are
// stored with the repo each one holds.
export function prepareConfig(input: unknown): AsdfConfig {
  if (!isObject(input)) fail('ASDF_CONFIG_INVALID', 'the config must be a JSON object');
  const config = structuredClone(input);
  config.lockStaleMinutes ??= 90;
  config.maxQuestionsPerRound ??= 4;
  config.workItemTypes ??= structuredClone(DEFAULT_TYPES);
  config.workspaces = toList(config.workspaces)
    .filter((entry) => entry)
    .map((entry) => {
      const path = String(isObject(entry) ? (entry.path ?? '') : entry);
      try {
        return resolveWorkspace(path);
      } catch (error) {
        const message = error instanceof AsdfError ? error.message : String((error as Error)?.message ?? error);
        fail('ASDF_CONFIG_INVALID', message);
      }
    });
  const errors = checkConfig(config);
  if (errors.length > 0) fail('ASDF_CONFIG_INVALID', errors[0]);
  return normalizeConfig(config);
}

export function setConfig(input: Json): Json {
  return withSettingsGuard(() => {
    const config = prepareConfig(input);
    writeJson(join(contextPath(), 'asdf.config.json'), config);
    return getConfig();
  });
}
