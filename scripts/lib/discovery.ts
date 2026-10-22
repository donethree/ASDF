import { getItem } from './items.ts';
import { getConfig } from './settings.ts';
import { scopeKey, type AsdfConfig, type WatchSource } from './watchScopes.ts';
import { fail, same } from './util.ts';

export type DiscoveryFilters = { types: string[]; completedStates: string[] };
export const QUERY_PAGE_SIZE = 200;
function argument(condition: unknown, message: string): asserts condition {
  if (!condition) fail('ASDF_BAD_ARGUMENT', message);
}
function quote(value: unknown): string {
  argument(typeof value === 'string' && value.trim() && !/[\u0000-\u001f\u007f]/.test(value), 'query values must be nonempty text without control characters');
  return `'${value.replace(/'/g, "''")}'`;
}
function cursor(value: number): void {
  argument(Number.isSafeInteger(value) && value >= 0, 'AfterId must be a nonnegative integer');
}
function positiveId(value: number): void {
  argument(Number.isSafeInteger(value) && value > 0, 'work item IDs must be positive integers');
}
export function discoverySources(config: AsdfConfig = getConfig()): (WatchSource & { index: number })[] {
  if (!config) fail('ASDF_NOT_INITIALIZED', 'run node asdf.js --init manually');
  const sources = config.orgs.flatMap(o => o.projects.flatMap(p =>
    p.watchScopes.map(scope => ({ org: o.org, project: p.project, scope }))));
  return sources.map((source, index) => ({ index, ...source }));
}
export function buildDiscoveryQuery(source: WatchSource, filters: DiscoveryFilters, afterId = 0): string {
  cursor(afterId);
  argument(Array.isArray(filters.types) && filters.types.length && Array.isArray(filters.completedStates), 'provide type names and completed/removed state names');
  const clauses = [`[System.TeamProject] = ${quote(source.project)}`, '[System.AssignedTo] = @Me',
    `[System.WorkItemType] IN (${filters.types.map(quote).join(', ')})`,
    ...(filters.completedStates.length ? [`[System.State] NOT IN (${filters.completedStates.map(quote).join(', ')})`] : []),
    "[System.Tags] NOT CONTAINS 'asdf'"];
  if (source.scope.kind === 'team') {
    clauses.push(`[System.AreaPath] IN (@TeamAreas(${quote(`[${source.project}]\\${source.scope.team}`)}))`);
  } else {
    argument(source.scope.kind === 'project' && Array.isArray(source.scope.areaPaths), 'invalid watch scope');
    if (source.scope.areaPaths.length) clauses.push(`(${source.scope.areaPaths.map(p => `[System.AreaPath] UNDER ${quote(p)}`).join(' OR ')})`);
  }
  clauses.push(`[System.Id] > ${afterId}`);
  return `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [System.Id] ASC`;
}
export function buildAssignmentQuery(project: string, trackedIds: number[], afterId = 0): string {
  cursor(afterId);
  argument(Array.isArray(trackedIds) && trackedIds.length > 0 && trackedIds.length <= QUERY_PAGE_SIZE, `provide 1-${QUERY_PAGE_SIZE} tracked IDs`);
  trackedIds.forEach(positiveId);
  const ids = [...new Set(trackedIds)].sort((a, b) => a - b);
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${quote(project)} AND [System.AssignedTo] = @Me AND [System.Id] IN (${ids.join(', ')}) AND [System.Id] > ${afterId} ORDER BY [System.Id] ASC`;
}
export function nextIdPage(ids: number[], afterId: number, pageSize: number): { ids: number[]; afterId: number | null } {
  cursor(afterId);
  argument(Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 1000, 'PageSize must be 1-1000');
  argument(Array.isArray(ids) && ids.length <= pageSize, 'response exceeds the requested page size');
  let previous = afterId;
  for (const id of ids) {
    positiveId(id);
    argument(id > previous, 'query IDs must be unique, ascending and beyond the cursor');
    previous = id;
  }
  return { ids, afterId: ids.length === pageSize ? previous : null };
}
export function discoveryQuery(index: number, input: unknown, afterId = 0) {
  argument(input !== null && typeof input === 'object' && !Array.isArray(input), 'filters must be an object');
  const value = input as Record<string, unknown>;
  const source = discoverySources()[index];
  argument(value.expectedSource && typeof value.expectedSource === 'object' && !Array.isArray(value.expectedSource), 'provide expectedSource from discovery-sources');
  const expected = value.expectedSource as Record<string, unknown>;
  argument(typeof expected.org === 'string' && typeof expected.project === 'string'
    && expected.scope && typeof expected.scope === 'object' && !Array.isArray(expected.scope), 'invalid expected source identity');
  const scope = expected.scope as Record<string, unknown>;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
  argument((scope.kind === 'team' && typeof scope.team === 'string')
    || (scope.kind === 'project' && strings(scope.areaPaths)), 'invalid expected watch scope');
  const expectedScope = scope.kind === 'team'
    ? { kind: 'team' as const, team: String(scope.team) }
    : { kind: 'project' as const, areaPaths: scope.areaPaths as string[] };
  if (!source || !same(source.org, expected.org) || !same(source.project, expected.project)
    || scopeKey(source.scope) !== scopeKey(expectedScope)) {
    fail('ASDF_DISCOVERY_CHANGED', 'watch source changed; reload discovery-sources before querying');
  }
  argument(strings(value.types) && strings(value.completedStates), 'provide arrays of type and state names');
  return { source, query: buildDiscoveryQuery(source, { types: value.types, completedStates: value.completedStates }, afterId), pageSize: QUERY_PAGE_SIZE };
}
export function assignmentQuery(org: string, project: string, ids: number[], afterId = 0) {
  const config = getConfig();
  argument(config?.orgs.some((o: { org: string }) => same(o.org, org)), 'assignment organization is not configured');
  const query = buildAssignmentQuery(project, ids, afterId);
  for (const id of ids) {
    const item = getItem(id);
    argument(same(item.org, org) && same(item.project, project), `tracked item ${id} belongs to another org/project`);
  }
  return { org, project, query, pageSize: QUERY_PAGE_SIZE };
}
