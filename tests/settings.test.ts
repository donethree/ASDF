import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { branchPrefix, checkConfig, contextPath, getConfig, getSettings, setConfig, setSettings, settingsPath } from '../scripts/lib/settings.ts';
import { git, newContext, newFolder, newWorkspace, sampleConfig, uninitialized, type TestContext } from './helpers.ts';

describe('settings', () => {
  beforeEach(() => {
    uninitialized();
  });

  it('is not initialized without a settings file', () => {
    assert.equal(getSettings(), null);
    assert.throws(() => contextPath(), { code: 'ASDF_NOT_INITIALIZED' });
  });

  it('saves a context path with spaces and creates the folder', () => {
    const path = join(newFolder(), 'ctx with space');
    setSettings(path);
    assert.equal(contextPath(), path);
    assert.ok(existsSync(path));
  });

  it('rejects a relative context path', () => {
    assert.throws(() => setSettings(join('rel', 'ctx')), { code: 'ASDF_CONTEXT_NOT_ABSOLUTE' });
  });

  it('rejects a context path inside a git work tree', () => {
    const repo = join(newFolder(), 'repo');
    git('init', '-q', repo);
    assert.throws(() => setSettings(join(repo, 'ctx')), { code: 'ASDF_CONTEXT_INSIDE_REPO' });
  });

  it('keeps settings under the Copilot folder by default, never ~/.asdf', () => {
    delete process.env.ASDF_SETTINGS;
    assert.equal(settingsPath(), join(homedir(), '.copilot', 'asdf', 'settings.json'));
  });

  it('has no branch prefix before init', () => {
    assert.equal(branchPrefix(), null);
  });
});

describe('config', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = newContext();
  });

  it('accepts the sample config and fills in the defaults', () => {
    const config = getConfig();
    assert.deepEqual(checkConfig(config), []);
    assert.equal(config.lockStaleMinutes, 90);
    assert.equal(config.maxQuestionsPerRound, 4);
    assert.ok(config.workItemTypes.parent.includes('Product Backlog Item'));
  });

  it('rejects configs without numeric schema version 2 before saving', () => {
    const file = join(ctx.context, 'asdf.config.json');
    const before = readFileSync(file, 'utf8');
    for (const schemaVersion of [1, '1', 3, '2', undefined]) {
      const config = { ...sampleConfig([ctx.workspace]), schemaVersion };
      assert.ok(checkConfig(config).includes('schemaVersion must be 2'));
      assert.throws(() => setConfig(config), { code: 'ASDF_CONFIG_INVALID', message: /schemaVersion must be 2/ });
      assert.equal(readFileSync(file, 'utf8'), before);
    }
  });

  it('requires an org with an MCP server and a project, and positive limits', () => {
    assert.ok(checkConfig({ ...getConfig(), orgs: [] }).includes('orgs must list at least one org'));
    assert.ok(checkConfig({ ...getConfig(), lockStaleMinutes: 0 }).includes('lockStaleMinutes must be a positive number'));
    const noMcpServer = { ...sampleConfig([ctx.workspace]), orgs: [{ org: 'contoso', projects: [{ project: 'Storage' }] }] };
    assert.throws(() => setConfig(noMcpServer), { code: 'ASDF_CONFIG_INVALID', message: /mcpServer/ });
  });

  it('stores each workspace with the repo it holds', () => {
    assert.deepEqual(getConfig().workspaces, [{ path: ctx.workspace, name: 'Storage', org: 'contoso', project: 'Storage', repo: 'Storage' }]);
  });

  it('rejects workspaces it cannot use', () => {
    const plain = join(ctx.src, 'plain');
    mkdirSync(plain, { recursive: true });
    const cases: Record<string, string[]> = {
      'a missing folder': [join(ctx.src, 'missing')],
      'a folder that is not a git checkout': [plain],
      'a checkout of a GitHub repo': [newWorkspace(join(ctx.src, 'gh'), 'https://github.com/contoso/tools.git')],
      'the same repo twice': [ctx.workspace, newWorkspace(join(ctx.src, 'Storage2'), 'https://dev.azure.com/contoso/Storage/_git/Storage')],
      'a repo in an org that is not configured': [newWorkspace(join(ctx.src, 'other'), 'https://dev.azure.com/fabrikam/Web/_git/Site')],
      'no workspaces': [],
    };
    for (const [why, workspaces] of Object.entries(cases)) {
      assert.throws(() => setConfig(sampleConfig(workspaces)), { code: 'ASDF_CONFIG_INVALID' }, why);
    }
  });

  it('derives the branch prefix from the user name', () => {
    assert.equal(branchPrefix(), 'user/jdoe');
  });

  const CURRENT_TYPES = { parent: ['Product Backlog Item', 'User Story'], task: ['Task', 'Bug'], feature: ['Feature'] };

  it('fills in a Feature list, and keeps Feature out of the parent list', () => {
    assert.deepEqual(getConfig().workItemTypes, CURRENT_TYPES);
  });

  it('requires an explicit Feature list instead of migrating parent types', () => {
    const file = join(ctx.context, 'asdf.config.json');
    const config = getConfig();
    for (const parent of [['User Story', 'Feature'], ['User Story']]) {
      const invalid = { ...config, workItemTypes: { parent, task: ['Task'] } };
      assert.ok(checkConfig(invalid).includes('workItemTypes.feature must be an array'));
      writeFileSync(file, JSON.stringify(invalid));
      const before = readFileSync(file, 'utf8');
      assert.throws(() => getConfig(), { code: 'ASDF_CONFIG_INVALID', message: /feature types must be an array/ });
      assert.throws(() => setConfig(invalid), { code: 'ASDF_CONFIG_INVALID', message: /feature/ });
      assert.equal(readFileSync(file, 'utf8'), before);
    }
  });

  it('refuses a type in two lists', () => {
    const types = { parent: ['Feature'], task: ['Task'], feature: ['Feature'] };
    assert.ok(checkConfig({ ...getConfig(), workItemTypes: types }).includes("work item type 'Feature' is in more than one workItemTypes list"));
  });

  it('allows an empty Feature list', () => {
    assert.deepEqual(checkConfig({ ...getConfig(), workItemTypes: { parent: ['User Story'], task: ['Task'], feature: [] } }), []);
  });

  it('preserves explicitly configured work item type lists', () => {
    const types = { parent: ['User Story', 'Feature'], task: ['Task'], feature: [] };
    setConfig({ ...getConfig(), workItemTypes: types });
    assert.deepEqual(getConfig().workItemTypes, types);
  });

  it('requires a user name that is safe in a branch name', () => {
    for (const userName of [null, 'j doe', 'user/jdoe', '.hidden', 'j..doe', 'jdoe.lock', 'jdoe.']) {
      assert.throws(() => setConfig(sampleConfig([ctx.workspace], userName)), { code: 'ASDF_CONFIG_INVALID', message: /userName/ }, String(userName));
    }
  });
});
