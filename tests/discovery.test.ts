import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildAssignmentQuery, buildDiscoveryQuery, discoverySources, nextIdPage } from '../scripts/lib/discovery.ts';
import { getConfig, setConfig } from '../scripts/lib/settings.ts';
import { newItem } from '../scripts/lib/items.ts';
import { newContext, newFolder, runCli } from './helpers.ts';

describe('discovery and assignment queries', () => {
  it('uses explicit team scope with escaped names and a cursor', () => {
    const query = buildDiscoveryQuery({ org: 'contoso', project: 'Commerce', scope: { kind: 'team', team: "Data's Movement" } },
      { types: ['Feature', 'Product Backlog Item'], completedStates: ['Done'] }, 42);
    assert.ok(query.includes("@TeamAreas('[Commerce]\\Data''s Movement')"));
    assert.ok(query.includes("[System.WorkItemType] IN ('Feature', 'Product Backlog Item')"));
    assert.ok(query.includes('[System.Id] > 42'));
    assert.ok(query.endsWith('ORDER BY [System.Id] ASC'));
  });
  it('keeps assignment inventory independent of discovery filters and includes tracked IDs', () => {
    const query = buildAssignmentQuery('Commerce', [42, 43]);
    assert.ok(query.includes('[System.AssignedTo] = @Me'));
    assert.ok(query.includes('[System.Id] IN (42, 43)'));
    for (const forbidden of ['AreaPath', 'TeamAreas', 'WorkItemType', 'System.State', 'Tags']) assert.equal(query.includes(forbidden), false);
    assert.throws(() => buildAssignmentQuery('Commerce', []), { code: 'ASDF_BAD_ARGUMENT' });
  });
  it('enumerates no discovery from a repository-only project', () => {
    newContext();
    const config = getConfig();
    config.orgs[0].projects = [{ project: 'Storage', watchScopes: [] },
      { project: 'Commerce', watchScopes: [{ kind: 'team', team: 'One' }, { kind: 'team', team: 'Two' }] }];
    assert.deepEqual(discoverySources(config).map(s => s.project), ['Commerce', 'Commerce']);
  });
  it('advances full pages and rejects ambiguous or nonadvancing results', () => {
    assert.deepEqual(nextIdPage([43, 44], 42, 2), { ids: [43, 44], afterId: 44 });
    assert.deepEqual(nextIdPage([45], 44, 2), { ids: [45], afterId: null });
    assert.deepEqual(nextIdPage([], 44, 2), { ids: [], afterId: null });
    for (const ids of [[44, 44], [42], [45, 44], [43, 44, 45]]) {
      assert.throws(() => nextIdPage(ids, 42, 2), { code: 'ASDF_BAD_ARGUMENT' });
    }
  });
  it('rejects source index drift and validates tracked item identity at the CLI', () => {
    newContext();
    const sources = runCli('discovery-sources');
    assert.equal(sources.code, 0);
    const filter = join(newFolder(), 'filter.json');
    writeFileSync(filter, JSON.stringify({ expectedSource: sources.json[0], types: ['Task'], completedStates: ['Done'] }));
    assert.equal(runCli('discovery-query', '-Index', '0', '-File', filter).code, 0);
    const malformed = join(newFolder(), 'bad-filter.json');
    writeFileSync(malformed, JSON.stringify({ expectedSource: { ...sources.json[0], scope: { kind: 'team', team: 42 } }, types: ['Task'], completedStates: [] }));
    assert.equal(runCli('discovery-query', '-Index', '0', '-File', malformed).json.error, 'ASDF_BAD_ARGUMENT');
    const config = getConfig();
    config.orgs[0].projects[0].watchScopes = [{ kind: 'team', team: 'Other' }];
    setConfig(config);
    assert.equal(runCli('discovery-query', '-Index', '0', '-File', filter).json.error, 'ASDF_DISCOVERY_CHANGED');
    newItem({ id: 42, org: 'contoso', project: 'Unwatched', kind: 'parent', type: 'User Story', title: 'Explicit intake' });
    const ids = join(newFolder(), 'ids.json');
    writeFileSync(ids, '[42]');
    assert.equal(runCli('assignment-query', '-Org', 'contoso', '-Project', 'Unwatched', '-File', ids).code, 0);
    assert.equal(runCli('assignment-query', '-Org', 'contoso', '-Project', 'Wrong', '-File', ids).json.error, 'ASDF_BAD_ARGUMENT');
  });
});
