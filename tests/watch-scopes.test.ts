import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { normalizeConfig } from '../scripts/lib/watchScopes.ts';
import { getConfig, validateContextPath } from '../scripts/lib/settings.ts';
import { newContext, newFolder } from './helpers.ts';

describe('watch configuration', () => {
  it('reads v2 scopes without changing the persisted file', () => {
    const ctx = newContext();
    const file = join(ctx.context, 'asdf.config.json');
    const config = { ...getConfig(), orgs: [{ org: 'contoso', mcpServer: 'ado-contoso',
      projects: [{ project: 'Commerce', watchScopes: [{ kind: 'project', areaPaths: ['Commerce\\Payments'] }] }] }] };
    writeFileSync(file, JSON.stringify(config));
    const before = readFileSync(file, 'utf8');
    assert.deepEqual(getConfig().orgs[0].projects[0].watchScopes, [{ kind: 'project', areaPaths: ['Commerce\\Payments'] }]);
    assert.equal(getConfig().schemaVersion, 2);
    assert.equal(readFileSync(file, 'utf8'), before);
  });

  it('rejects configs without numeric schema version 2 without rewriting them', () => {
    const ctx = newContext();
    const file = join(ctx.context, 'asdf.config.json');
    const config = getConfig();
    for (const schemaVersion of [1, '1', 3, '2', undefined]) {
      const invalid = { ...config, schemaVersion };
      writeFileSync(file, JSON.stringify(invalid));
      const before = readFileSync(file, 'utf8');
      assert.throws(() => normalizeConfig(invalid), { code: 'ASDF_CONFIG_INVALID', message: /schemaVersion must be 2/ });
      assert.throws(() => getConfig(), { code: 'ASDF_CONFIG_INVALID', message: /schemaVersion must be 2/ });
      assert.equal(readFileSync(file, 'utf8'), before);
    }
  });

  it('does not infer a watch scope from legacy project area paths', () => {
    newContext();
    const config = getConfig();
    config.orgs[0].projects = [{ project: 'Storage', areaPaths: ['Storage\\Payments'] }];
    assert.throws(() => normalizeConfig(config), { code: 'ASDF_CONFIG_INVALID', message: /watchScopes/ });
  });

  it('distinguishes unwatched projects from missing scopes', () => {
    newContext();
    const config = getConfig();
    config.orgs[0].projects = [
      { project: 'Commerce', watchScopes: [] },
      { project: 'Storage', watchScopes: [{ kind: 'team', team: 'Data Movement' }] },
    ];
    assert.deepEqual(normalizeConfig(config).orgs[0].projects[0].watchScopes, []);
    delete config.orgs[0].projects[0].watchScopes;
    assert.throws(() => normalizeConfig(config), { code: 'ASDF_CONFIG_INVALID' });
  });

  it('rejects duplicate teams, newer schema and empty total watches', () => {
    newContext();
    const config = getConfig();
    assert.throws(() => normalizeConfig({ ...config, schemaVersion: 3 }), { code: 'ASDF_CONFIG_INVALID' });
    config.orgs[0].projects[0].watchScopes = [{ kind: 'team', team: 'Payments' }, { kind: 'team', team: 'payments' }];
    assert.throws(() => normalizeConfig(config), { code: 'ASDF_CONFIG_INVALID' });
    config.orgs[0].projects[0].watchScopes = [];
    assert.throws(() => normalizeConfig(config), { code: 'ASDF_CONFIG_INVALID' });
  });

  it('keeps saved limits and validates context without creating it', () => {
    newContext();
    const config = normalizeConfig({ ...getConfig(), lockStaleMinutes: 17, maxQuestionsPerRound: 2 });
    assert.equal(config.lockStaleMinutes, 17);
    assert.equal(config.maxQuestionsPerRound, 2);
    const folder = join(newFolder(), 'not created');
    assert.equal(validateContextPath(folder), folder);
    assert.equal(existsSync(folder), false);
  });

  it('registers a code-only project without implicitly watching it', () => {
    newContext();
    const config = getConfig();
    config.workspaces[0].project = 'CodeOnly';
    const normalized = normalizeConfig(config);
    assert.deepEqual(normalized.orgs[0].projects.find(p => p.project === 'CodeOnly'),
      { project: 'CodeOnly', watchScopes: [] });
  });
});
