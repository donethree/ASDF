import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { atomicText, inside, physical } from './localState.ts';
import { STAGES } from './items.ts';
import { prepareConfig, settingsPath, validateContextPath, withSettingsGuard } from './settings.ts';
import { configRecord, DEFAULT_TYPES, normalizeConfig, type AsdfConfig } from './watchScopes.ts';
import { fail, same } from './util.ts';
import { isLiveReserved, parseLiveWatch } from './liveWatch.ts';

export type SetupPaths = { settingsFile: string; mcpFile: string; copilotSettingsFile: string };
export type FileSnapshot = { path: string; content: string | null };
export type SetupDraft = { contextPath: string; config: AsdfConfig; mcp: Record<string, unknown> | null };
export type LoadedSetup = { paths: SetupPaths; snapshots: FileSnapshot[]; originalContext: string | null;
  originalConfig: AsdfConfig | null; draft: SetupDraft; pluginWarnings: string[] };
export type PlannedWrite = FileSnapshot & { nextContent: string };
export type SetupWritePlan = { loaded: LoadedSetup; draft: SetupDraft; writes: PlannedWrite[] };
export type SetupStore = { read(path: string): string | null; replace(path: string, content: string): void; remove(path: string): void };

export const setupStore: SetupStore = {
  read(path) {
    try { return readFileSync(path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      fail('ASDF_SETUP_INVALID', `cannot read ${path}: ${(error as Error).message}`);
    }
  },
  replace: atomicText,
  remove: (path) => rmSync(path),
};
function record(content: string, path: string): Record<string, unknown> {
  try { return configRecord(JSON.parse(content.replace(/^\uFEFF/, '')), path); }
  catch { return fail('ASDF_SETUP_INVALID', `invalid JSON object in ${path}; preserve and repair it before setup`); }
}
function canonical(path: string): string {
  if (!isAbsolute(path)) fail('ASDF_SETUP_INVALID', `expected an absolute file path: ${path}`);
  return physical(path, 'ASDF_SETUP_INVALID');
}
export const sameSetupPath = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
function snapshot(loaded: Pick<LoadedSetup, 'snapshots'>, path: string): FileSnapshot {
  path = canonical(path);
  let found = loaded.snapshots.find(s => sameSetupPath(s.path, path));
  if (!found) {
    found = { path, content: setupStore.read(path) };
    loaded.snapshots.push(found);
  }
  return found;
}
function contextFile(context: string): string {
  const root = canonical(context);
  const file = canonical(join(context, 'asdf.config.json'));
  if (!inside(root, file)) fail('ASDF_SETUP_INVALID', 'context config resolves outside the context folder');
  return file;
}
function mcpServers(mcp: Record<string, unknown>): Record<string, unknown> {
  return configRecord(mcp.mcpServers, 'mcpServers');
}

export function loadSetup(paths: SetupPaths = {
  settingsFile: settingsPath(), mcpFile: join(homedir(), '.copilot', 'mcp-config.json'),
  copilotSettingsFile: join(homedir(), '.copilot', 'settings.json'),
}): LoadedSetup {
  paths = { ...paths, settingsFile: canonical(paths.settingsFile), copilotSettingsFile: canonical(paths.copilotSettingsFile) };
  const loaded: LoadedSetup = { paths, snapshots: [], originalContext: null, originalConfig: null,
    draft: { contextPath: '', mcp: null, config: {
      schemaVersion: 2, userName: userInfo().username, orgs: [], workItemTypes: structuredClone(DEFAULT_TYPES),
      workspaces: [], lockStaleMinutes: 90, maxQuestionsPerRound: 4,
    } }, pluginWarnings: [] };
  const settings = snapshot(loaded, paths.settingsFile);
  if (settings.content !== null) {
    const value = record(settings.content, settings.path);
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== '1') fail('ASDF_SETUP_INVALID', 'unsupported personal settings schema; setup will not downgrade it');
    if (typeof value.contextPath !== 'string' || !isAbsolute(value.contextPath)) fail('ASDF_SETUP_INVALID', 'settings need an absolute contextPath');
    loaded.originalContext = resolve(value.contextPath);
    loaded.draft.contextPath = loaded.originalContext;
    const config = snapshot(loaded, contextFile(loaded.originalContext));
    if (config.content !== null) loaded.originalConfig = normalizeConfig(record(config.content, config.path));
    if (loaded.originalConfig) loaded.draft.config = structuredClone(loaded.originalConfig);
  }
  const plugins = { path: paths.copilotSettingsFile, content: setupStore.read(paths.copilotSettingsFile) };
  if (plugins.content !== null) {
    const settings = record(plugins.content, plugins.path);
    if (settings.enabledPlugins !== undefined) {
      for (const [name, enabled] of Object.entries(configRecord(settings.enabledPlugins, 'enabledPlugins'))) {
        if (enabled === true && /^(superpowers|superlite)@/.test(name)) {
          loaded.pluginWarnings.push(`${name} shares skill names with ASDF; review it with /plugin. Setup will not change it.`);
        }
      }
    }
  }
  return loaded;
}

export function loadSetupMcp(loaded: LoadedSetup): Record<string, unknown> {
  if (loaded.draft.mcp !== null) return loaded.draft.mcp;
  const file = snapshot(loaded, loaded.paths.mcpFile);
  const mcp = file.content === null ? { mcpServers: {} } : record(file.content, file.path);
  if (mcp.mcpServers === undefined) mcp.mcpServers = {};
  mcpServers(mcp);
  loaded.paths.mcpFile = file.path;
  loaded.draft.mcp = mcp;
  return mcp;
}

export function selectContext(loaded: LoadedSetup, path: string): LoadedSetup {
  const validated = validateContextPath(path);
  if (loaded.draft.contextPath && sameSetupPath(loaded.draft.contextPath, validated)) return structuredClone(loaded);
  const next = structuredClone(loaded);
  next.draft.contextPath = validated;
  const config = snapshot(next, contextFile(next.draft.contextPath));
  if (config.content !== null) next.draft.config = normalizeConfig(record(config.content, config.path));
  return next;
}

export function findMcpMatches(mcp: Record<string, unknown>, org: string): string[] {
  return Object.entries(mcpServers(mcp)).filter(([, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const server = entry as Record<string, unknown>;
    if (typeof server.url === 'string') {
      try {
        const url = new URL(server.url);
        if (url.protocol === 'https:' && url.hostname.toLowerCase() === 'mcp.dev.azure.com'
          && same(decodeURIComponent(url.pathname.replace(/^\/|\/$/g, '')), org)) return true;
      } catch { return false; }
    }
    const args = server.args;
    return Array.isArray(args) && args.some(a => typeof a === 'string' && /^@azure-devops\/mcp(?:@.+)?$/.test(a))
      && args.some(a => same(a, org));
  }).map(([name]) => name);
}

export function addMcpEntry(draft: SetupDraft, org: string, name: string): void {
  if (!name.trim() || /[\u0000-\u001f\u007f]/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) fail('ASDF_SETUP_INPUT_INVALID', 'enter a valid MCP server name');
  const mcp = configRecord(draft.mcp, 'optional MCP draft');
  const servers = mcpServers(mcp);
  if (Object.hasOwn(servers, name) && !findMcpMatches(mcp, org).includes(name)) {
    fail('ASDF_SETUP_MCP_COLLISION', `${name} is already used by another server`);
  }
  if (!Object.hasOwn(servers, name)) {
    servers[name] = { type: 'http', url: `https://mcp.dev.azure.com/${encodeURIComponent(org)}`, headers: { 'X-MCP-Insiders': 'true' }, tools: ['*'] };
  } else {
    const server = configRecord(servers[name], name);
    if (typeof server.url === 'string') {
      const headers = configRecord(server.headers ?? {}, 'headers');
      const keys = Object.keys(headers).filter(k => k.toLowerCase() === 'x-mcp-insiders');
      if (keys.length > 1) fail('ASDF_SETUP_INVALID', `${name} has duplicate Insiders header keys`);
      headers[keys[0] ?? 'X-MCP-Insiders'] = 'true';
      server.headers = headers;
    }
  }
  const configured = draft.config.orgs.find(o => same(o.org, org));
  if (configured) configured.mcpServer = name;
}

type Dependency = { id: number; stage: string; org: string; project: string; repo: Record<string, unknown> };
function dependencies(context: string): Dependency[] {
  let entries;
  try { entries = readdirSync(context, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    fail('ASDF_SETUP_INVALID', `cannot inspect context ${context}`);
  }
  const result: Dependency[] = [];
  for (const entry of entries) {
    if (!/^\d+-/.test(entry.name)) continue;
    const folder = canonical(join(context, entry.name));
    if (!inside(canonical(context), folder)) fail('ASDF_SETUP_INVALID', 'item folder escapes the context');
    const file = join(folder, 'state.json');
    const raw = setupStore.read(file);
    if (raw === null) fail('ASDF_SETUP_INVALID', `missing item state: ${file}`);
    const state = record(raw, file);
    if (typeof state.id !== 'number' || !Number.isSafeInteger(state.id) || typeof state.stage !== 'string'
      || !STAGES.some(s => s === state.stage) || typeof state.org !== 'string' || typeof state.project !== 'string') {
      fail('ASDF_SETUP_INVALID', `cannot determine item safety: ${file}`);
    }
    if (existsSync(join(folder, '.lock')) || existsSync(join(folder, 'session', 'active-run.json'))) {
      fail('ASDF_SETUP_IN_USE', `item ${state.id} has an active or unresolved operation; finish or recover it before saving setup`);
    }
    const live = setupStore.read(join(folder, 'live-watch.json'));
    if (live !== null && isLiveReserved(parseLiveWatch(record(live, 'live-watch.json'), { id: state.id, org: state.org, project: state.project }))) {
      fail('ASDF_SETUP_IN_USE', `item ${state.id} is reserved by an interactive session`);
    }
    if (state.stage !== 'done') result.push({ id: state.id, stage: state.stage, org: state.org, project: state.project,
      repo: configRecord(state.repo, 'item repo') });
  }
  return result;
}

function preserveConnections(config: AsdfConfig, previous: AsdfConfig | null, items: Dependency[]): void {
  const identities = items.flatMap(item => [{ org: item.org, project: item.project },
    ...(typeof item.repo.org === 'string' && typeof item.repo.project === 'string' ? [{ org: item.repo.org, project: item.repo.project }] : [])]);
  for (const id of identities) {
    let org = config.orgs.find(o => same(o.org, id.org));
    if (!org) {
      const old = previous?.orgs.find(o => same(o.org, id.org));
      if (!old) fail('ASDF_SETUP_IN_USE', `unfinished work needs its organization ${id.org}`);
      org = { org: old.org, ...(old.mcpServer === undefined ? {} : { mcpServer: old.mcpServer }), projects: [] };
      config.orgs.push(org);
    }
    if (!org.projects.some(p => same(p.project, id.project))) org.projects.push({ project: id.project, watchScopes: [] });
  }
}

export function prepareSetupSave(input: LoadedSetup): SetupWritePlan {
  const loaded = structuredClone(input);
  const draft = loaded.draft;
  draft.contextPath = validateContextPath(draft.contextPath);
  const target = snapshot(loaded, contextFile(draft.contextPath));
  const previous = target.content === null ? null : normalizeConfig(record(target.content, target.path));
  const items = dependencies(draft.contextPath);
  if (loaded.originalContext && !sameSetupPath(loaded.originalContext, draft.contextPath)) {
    const oldItems = dependencies(loaded.originalContext);
    if (oldItems.length) fail('ASDF_SETUP_IN_USE', `context is still needed by unfinished items: ${oldItems.map(i => i.id).join(', ')}`);
  }
  preserveConnections(draft.config, previous, items);
  draft.config = prepareConfig(draft.config);
  for (const item of items) {
    if (previous && draft.config.userName !== previous.userName && typeof item.repo.branch === 'string' && item.repo.branch) {
      fail('ASDF_SETUP_IN_USE', `item ${item.id} still uses the current branch username`);
    }
    if (typeof item.repo.clonePath === 'string' && item.repo.clonePath) {
      const workspace = draft.config.workspaces.find(w => same(w.org, item.repo.org) && same(w.project, item.repo.project) && same(w.repo, item.repo.name));
      if (!workspace || !sameSetupPath(workspace.path, item.repo.clonePath)) fail('ASDF_SETUP_IN_USE', `item ${item.id} still needs its recorded checkout`);
    }
  }
  const settings = snapshot(loaded, loaded.paths.settingsFile);
  const writes: PlannedWrite[] = [];
  const plan = (s: FileSnapshot, value: unknown) => {
    if (s.content !== null && JSON.stringify(record(s.content, s.path)) === JSON.stringify(value)) return;
    writes.push({ ...s, nextContent: JSON.stringify(value, null, 2) + '\n' });
  };
  if (draft.mcp !== null) {
    const file = snapshot(loaded, loaded.paths.mcpFile);
    const previous = file.content === null ? {} : record(file.content, file.path);
    previous.mcpServers ??= {};
    if (JSON.stringify(previous) !== JSON.stringify(draft.mcp)) plan(file, draft.mcp);
  }
  plan(target, draft.config);
  plan(settings, { ...(settings.content === null ? {} : record(settings.content, settings.path)), schemaVersion: 1, contextPath: draft.contextPath });
  return { loaded, draft, writes };
}

export function saveSetup(plan: SetupWritePlan, store: SetupStore = setupStore): { written: string[] } {
  return withSettingsGuard(() => {
    for (const before of plan.loaded.snapshots) {
      if (store.read(before.path) !== before.content) fail('ASDF_SETUP_CONFLICT', `file changed during setup: ${before.path}; reload and review again`);
    }
    const fresh = prepareSetupSave(plan.loaded);
    if (JSON.stringify(fresh.writes) !== JSON.stringify(plan.writes)) fail('ASDF_SETUP_CONFLICT', 'local dependencies changed; review the draft again');
    const written: PlannedWrite[] = [];
    try {
      for (const write of plan.writes) {
        if (store.read(write.path) !== write.content) fail('ASDF_SETUP_CONFLICT', `file changed before writing: ${write.path}`);
        store.replace(write.path, write.nextContent);
        written.push(write);
      }
      return { written: written.map(w => w.path) };
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const write of written.reverse()) {
        try {
          if (store.read(write.path) !== write.nextContent) { rollbackErrors.push(`${write.path} changed externally; left untouched`); continue; }
          if (write.content === null) store.remove(write.path);
          else store.replace(write.path, write.content);
        } catch { rollbackErrors.push(`${write.path} could not be restored`); }
      }
      fail('ASDF_SETUP_SAVE_FAILED', `setup save failed: ${(error as Error).message}${rollbackErrors.length ? `; partial rollback: ${rollbackErrors.join('; ')}` : '; earlier writes restored'}`);
    }
  }, plan.loaded.paths.settingsFile);
}
