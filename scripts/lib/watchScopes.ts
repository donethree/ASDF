import { normalizeWorktreeRoot, type Workspace } from './workspaces.ts';
import { fail } from './util.ts';

export type WatchScope = { kind: 'project'; areaPaths: string[] } | { kind: 'team'; team: string };
export type ProjectConfig = { project: string; watchScopes: WatchScope[] };
export type OrgConfig = { org: string; mcpServer: string; projects: ProjectConfig[] };
export type AsdfConfig = {
  schemaVersion: 2; userName: string; orgs: OrgConfig[];
  workItemTypes: { parent: string[]; task: string[]; feature: string[] };
  workspaces: Workspace[]; lockStaleMinutes: number; maxQuestionsPerRound: number;
  worktreeRoot?: string;
  [key: string]: unknown;
};
export type ProjectIdentity = { org: string; project: string };
export type WatchSource = ProjectIdentity & { scope: WatchScope };
export const DEFAULT_TYPES = { parent: ['Product Backlog Item', 'User Story'], task: ['Task', 'Bug'], feature: ['Feature'] };

export function configRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ASDF_CONFIG_INVALID', `${label} must be an object`);
  return value as Record<string, unknown>;
}
export function configText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail('ASDF_CONFIG_INVALID', `${label} must be nonempty text without control characters`);
  return value.trim();
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail('ASDF_CONFIG_INVALID', `${label} must be an array`);
  return value;
}
function unique(values: string[], label: string): void {
  if (new Set(values.map(v => v.toLowerCase())).size !== values.length) fail('ASDF_CONFIG_INVALID', `duplicate ${label}`);
}
export function scopeKey(scope: WatchScope): string {
  return scope.kind === 'team' ? `team:${scope.team.toLowerCase()}`
    : `project:${JSON.stringify(scope.areaPaths.map(p => p.toLowerCase()).sort())}`;
}

export function normalizeConfig(input: unknown): AsdfConfig {
  const config = configRecord(structuredClone(input), 'config');
  if (config.schemaVersion !== 2) fail('ASDF_CONFIG_INVALID', 'schemaVersion must be 2');
  const orgs = list(config.orgs, 'orgs').map(entry => {
    const org = configRecord(entry, 'org');
    const projects = list(org.projects, 'projects').map(entry => {
      const project = configRecord(entry, 'project');
      const watchScopes: WatchScope[] = list(project.watchScopes, 'watchScopes').map(entry => {
        const scope = configRecord(entry, 'watch scope');
        if (scope.kind === 'team') return { kind: 'team', team: configText(scope.team, 'team') };
        if (scope.kind !== 'project') fail('ASDF_CONFIG_INVALID', 'watch scope kind must be project or team');
        const areaPaths = list(scope.areaPaths, 'areaPaths').map(v => configText(v, 'area path'));
        unique(areaPaths, 'area path');
        return { kind: 'project', areaPaths };
      });
      unique(watchScopes.map(scopeKey), 'watch scope');
      if (watchScopes.length > 1 && watchScopes.some(s => s.kind === 'project' && s.areaPaths.length === 0)) {
        fail('ASDF_CONFIG_INVALID', 'a whole-project watch already includes its narrower watches');
      }
      return { ...project, project: configText(project.project, 'project'), watchScopes };
    });
    if (!projects.length) fail('ASDF_CONFIG_INVALID', 'every org needs at least one project');
    unique(projects.map(p => p.project), 'project');
    return { ...org, org: configText(org.org, 'org'), mcpServer: configText(org.mcpServer, 'mcpServer'), projects };
  });
  if (!orgs.length) fail('ASDF_CONFIG_INVALID', 'orgs must list at least one org');
  unique(orgs.map(o => o.org), 'organization');
  if (!orgs.some(o => o.projects.some(p => p.watchScopes.length))) fail('ASDF_CONFIG_INVALID', 'at least one watch scope is required');
  const userName = configText(config.userName, 'userName');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(userName) || /\.\.|\.lock$|\.$/i.test(userName)) fail('ASDF_CONFIG_INVALID', 'userName is not safe in a branch name');
  const rawTypes = configRecord(config.workItemTypes ?? DEFAULT_TYPES, 'workItemTypes');
  const parent = list(rawTypes.parent, 'parent types').map(v => configText(v, 'parent type'));
  const task = list(rawTypes.task, 'task types').map(v => configText(v, 'task type'));
  const feature = list(rawTypes.feature, 'feature types').map(v => configText(v, 'feature type'));
  if (!parent.length || !task.length) fail('ASDF_CONFIG_INVALID', 'parent and task types must each list at least one type');
  unique([...parent, ...task, ...feature], 'work item type across type lists');
  const workspaces = list(config.workspaces, 'workspaces').map(entry => {
    const w = configRecord(entry, 'workspace');
    return { ...w, path: configText(w.path, 'workspace path'), name: configText(w.name, 'workspace name'),
      org: configText(w.org, 'workspace org'), project: configText(w.project, 'workspace project'), repo: configText(w.repo, 'workspace repo') };
  });
  if (!workspaces.length) fail('ASDF_CONFIG_INVALID', 'workspaces must list at least one local checkout');
  unique(workspaces.map(w => JSON.stringify([w.org, w.project, w.repo])), 'repository');
  for (const w of workspaces) {
    const org = orgs.find(o => o.org.toLowerCase() === w.org.toLowerCase());
    if (!org) fail('ASDF_CONFIG_INVALID', `workspace org '${w.org}' is not configured`);
    if (!org.projects.some(p => p.project.toLowerCase() === w.project.toLowerCase())) org.projects.push({ project: w.project, watchScopes: [] });
  }
  const number = (value: unknown, fallback: number) => {
    const v = value ?? fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail('ASDF_CONFIG_INVALID', 'configuration limits must be positive numbers');
    return v;
  };
  const worktreeRoot = config.worktreeRoot === undefined ? undefined : normalizeWorktreeRoot(configText(config.worktreeRoot, 'worktreeRoot'));
  return { ...config, ...(worktreeRoot === undefined ? {} : { worktreeRoot }), schemaVersion: 2, userName, orgs, workItemTypes: { parent, task, feature }, workspaces,
    lockStaleMinutes: number(config.lockStaleMinutes, 90), maxQuestionsPerRound: number(config.maxQuestionsPerRound, 4) };
}
