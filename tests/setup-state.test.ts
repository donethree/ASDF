import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { itemPath, newItem, setItemRepo } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { addMcpEntry, findMcpMatches, loadSetup, loadSetupMcp, prepareSetupSave, saveSetup, selectContext, setupStore, type LoadedSetup } from '../scripts/lib/setupState.ts';
import { contextPath, getConfig } from '../scripts/lib/settings.ts';
import { writeWorkerClaim } from '../scripts/lib/workerLease.ts';
import { newContext, newFolder, newWorkspace } from './helpers.ts';

describe('offline setup persistence', () => {
  let loaded: LoadedSetup;
  beforeEach(() => {
    const ctx = newContext();
    loaded = loadSetup({ settingsFile: ctx.settings, mcpFile: join(dirname(ctx.settings), 'mcp.json'),
      copilotSettingsFile: join(dirname(ctx.settings), 'copilot.json') });
    loadSetupMcp(loaded);
    addMcpEntry(loaded.draft, 'contoso', 'ado-contoso');
  });

  it('does not write a draft and preserves unrelated MCP data on confirmed save', () => {
    assert.equal(existsSync(loaded.paths.mcpFile), false);
    loaded.draft.mcp!.unrelated = { keep: 'yes' };
    const plan = prepareSetupSave(loaded);
    assert.equal(existsSync(loaded.paths.mcpFile), false);
    saveSetup(plan);
    const mcp = JSON.parse(readFileSync(loaded.paths.mcpFile, 'utf8'));
    assert.equal(mcp.unrelated.keep, 'yes');
    assert.equal(mcp.mcpServers['ado-contoso'].headers['X-MCP-Insiders'], 'true');
    assert.equal(getConfig().schemaVersion, 2);
  });

  it('creates a complete empty phase template only on confirmed save', () => {
    const file = join(loaded.draft.contextPath, 'custom-instructions', 'org-contoso', 'project-storage', 'repo-storage', 'instructions.json');
    const plan = prepareSetupSave(loaded);
    assert.equal(existsSync(file), false);
    saveSetup(plan);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      schemaVersion: 1,
      phases: {
        intake: { before: '', after: '' }, featureBreakdown: { before: '', after: '' },
        investigation: { before: '', after: '' }, design: { before: '', after: '' },
        designApproval: { before: '', after: '' }, planning: { before: '', after: '' },
        checkout: { before: '', after: '' }, implementation: { before: '', after: '' },
        selfReview: { before: '', after: '' }, pullRequest: { before: '', after: '' },
        prFeedback: { before: '', after: '' }, merge: { before: '', after: '' },
        closeOut: { before: '', after: '' },
      },
    });
  });

  it('preserves user instruction files byte-for-byte when setup is repeated', () => {
    saveSetup(prepareSetupSave(loaded));
    const file = join(loaded.draft.contextPath, 'custom-instructions', 'org-contoso', 'project-storage', 'repo-storage', 'instructions.json');
    const text = '{ "schemaVersion": 1, "phases": { "planning": { "after": "Use skill X" } } }\r\n';
    writeFileSync(file, text);
    const plan = prepareSetupSave(loadSetup(loaded.paths));
    assert.equal(plan.writes.some(write => write.path === file), false);
    saveSetup(plan);
    assert.equal(readFileSync(file, 'utf8'), text);
  });

  it('rolls back newly created templates when a later setup write fails', () => {
    loaded.draft.config.userName = 'edited';
    const plan = prepareSetupSave(loaded);
    const file = join(loaded.draft.contextPath, 'custom-instructions', 'org-contoso', 'project-storage', 'repo-storage', 'instructions.json');
    const settings = readFileSync(loaded.paths.settingsFile, 'utf8');
    assert.throws(() => saveSetup(plan, { ...setupStore, replace: (path, content) => {
      if (path.endsWith('asdf.config.json')) throw new Error('test config write failure');
      setupStore.replace(path, content);
    } }), { code: 'ASDF_SETUP_SAVE_FAILED' });
    assert.equal(existsSync(file), false);
    assert.equal(readFileSync(loaded.paths.settingsFile, 'utf8'), settings);
  });
  it('includes required remote tooling in the save plan without writing before Save', () => {
    const deferred = loadSetup(loaded.paths);
    delete deferred.draft.config.orgs[0].mcpServer;
    const plan = prepareSetupSave(deferred);
    assert.equal(plan.writes.some(w => w.path === loaded.paths.mcpFile), true);
    assert.equal(existsSync(loaded.paths.mcpFile), false);
    saveSetup(plan);
    assert.equal(getConfig().orgs[0].mcpServer, 'asdf-ado-contoso');
    const mcp = JSON.parse(readFileSync(loaded.paths.mcpFile, 'utf8'));
    assert.deepEqual(mcp.mcpServers['asdf-ado-contoso'].headers,
      { 'X-MCP-Insiders': 'true', 'X-MCP-Toolsets': 'wit,repos,pipelines' });
  });
  it('preserves local MCP servers and unrelated data while preparing a remote per organization', () => {
    const local = { command: 'npx', args: ['-y', '@azure-devops/mcp', 'contoso', '-d', 'work-items'],
      tools: ['wit_get_work_item'], env: { KEEP: 'value' } };
    writeFileSync(loaded.paths.mcpFile, JSON.stringify({ note: 'keep', mcpServers: { local } }));
    const next = loadSetup(loaded.paths);
    next.draft.config.orgs.push({ org: 'fabrikam', projects: [{ project: 'Commerce', watchScopes: [] }] });
    saveSetup(prepareSetupSave(next));
    const mcp = JSON.parse(readFileSync(loaded.paths.mcpFile, 'utf8'));
    assert.deepEqual(mcp.mcpServers.local, local);
    assert.equal(mcp.note, 'keep');
    assert.equal(mcp.mcpServers['asdf-ado-contoso'].url, 'https://mcp.dev.azure.com/contoso');
    assert.equal(mcp.mcpServers['asdf-ado-fabrikam'].url, 'https://mcp.dev.azure.com/fabrikam');
  });
  it('reports invalid MCP configuration without overwriting it during init', () => {
    const invalid = '{managed outside ASDF';
    writeFileSync(loaded.paths.mcpFile, invalid);
    const deferred = loadSetup(loaded.paths);
    deferred.draft.config.userName = 'edited';
    assert.throws(() => prepareSetupSave(deferred), { code: 'ASDF_SETUP_INVALID' });
    assert.notEqual(getConfig().userName, 'edited');
    assert.equal(readFileSync(loaded.paths.mcpFile, 'utf8'), invalid);
  });
  it('replaces an old optional hint with the prepared dedicated remote entry', () => {
    const deferred = loadSetup(loaded.paths);
    saveSetup(prepareSetupSave(deferred));
    assert.equal(getConfig().orgs[0].mcpServer, 'asdf-ado-contoso');
    assert.equal(existsSync(loaded.paths.mcpFile), true);
  });

  it('does not overwrite a dedicated name occupied by another server', () => {
    const raw = JSON.stringify({ mcpServers: { 'asdf-ado-contoso':
      { command: 'npx', args: ['-y', '@azure-devops/mcp', 'contoso'] } } });
    writeFileSync(loaded.paths.mcpFile, raw);
    assert.throws(() => prepareSetupSave(loadSetup(loaded.paths)), { code: 'ASDF_SETUP_MCP_COLLISION' });
    assert.equal(readFileSync(loaded.paths.mcpFile, 'utf8'), raw);
  });

  it('does not remove explicit restrictions from an existing dedicated remote', () => {
    for (const restriction of [
      { headers: { 'X-MCP-Readonly': 'true' } },
      { headers: { 'X-MCP-Tools': 'wit_work_item' } },
      { headers: { 'X-MCP-Toolsets': 'wit' } },
      { tools: ['wit_work_item'] },
      { disabled: true },
    ]) {
      const raw = JSON.stringify({ mcpServers: { 'asdf-ado-contoso':
        { type: 'http', url: 'https://mcp.dev.azure.com/contoso', ...restriction } } });
      writeFileSync(loaded.paths.mcpFile, raw);
      assert.throws(() => prepareSetupSave(loadSetup(loaded.paths)), { code: 'ASDF_SETUP_MCP_RESTRICTED' });
      assert.equal(readFileSync(loaded.paths.mcpFile, 'utf8'), raw);
    }
  });

  it('repairs missing remote headers without losing custom fields and saves idempotently', () => {
    writeFileSync(loaded.paths.mcpFile, JSON.stringify({ mcpServers: { 'asdf-ado-contoso':
      { type: 'http', url: 'https://mcp.dev.azure.com/contoso', headers: { 'X-Custom': 'keep' }, timeout: 12345 } } }));
    saveSetup(prepareSetupSave(loadSetup(loaded.paths)));
    const remote = JSON.parse(readFileSync(loaded.paths.mcpFile, 'utf8')).mcpServers['asdf-ado-contoso'];
    assert.equal(remote.headers['X-Custom'], 'keep');
    assert.equal(remote.headers['X-MCP-Insiders'], 'true');
    assert.equal(remote.timeout, 12345);
    assert.equal(prepareSetupSave(loadSetup(loaded.paths)).writes.length, 0);
  });

  it('finds existing local/remote entries without launching them or replacing a collision', () => {
    const mcp = { mcpServers: {
      remote: { url: 'https://mcp.dev.azure.com/contoso/' },
      local: { command: 'npx', args: ['-y', '@azure-devops/mcp@latest', 'contoso'] },
      other: { url: 'https://mcp.dev.azure.com/fabrikam' },
    } };
    assert.deepEqual(findMcpMatches(mcp, 'contoso'), ['remote', 'local']);
    loaded.draft.mcp = mcp;
    assert.throws(() => addMcpEntry(loaded.draft, 'contoso', 'other'), { code: 'ASDF_SETUP_MCP_COLLISION' });
  });

  it('refuses concurrent edits rather than overwriting them', () => {
    const plan = prepareSetupSave(loaded);
    writeFileSync(loaded.paths.mcpFile, '{"mcpServers":{"someoneElse":{}}}');
    assert.throws(() => saveSetup(plan), { code: 'ASDF_SETUP_CONFLICT' });
    assert.equal(readFileSync(loaded.paths.mcpFile, 'utf8'), '{"mcpServers":{"someoneElse":{}}}');
  });

  it('rolls back matching earlier writes when a later replacement fails', () => {
    loaded.draft.config.userName = 'newuser';
    const plan = prepareSetupSave(loaded);
    const before = readFileSync(join(loaded.draft.contextPath, 'asdf.config.json'), 'utf8');
    let count = 0;
    assert.throws(() => saveSetup(plan, { ...setupStore, replace: (path, content) => {
      if (++count === 2) throw new Error('test write failure');
      setupStore.replace(path, content);
    } }), { code: 'ASDF_SETUP_SAVE_FAILED' });
    assert.equal(existsSync(loaded.paths.mcpFile), false);
    assert.equal(readFileSync(join(loaded.draft.contextPath, 'asdf.config.json'), 'utf8'), before);
  });

  it('saves branch username changes without altering an active operation or its item', () => {
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
    setItemRepo(42, 'Storage');
    lockItem(42, 'active');
    const folder = itemPath(42)!;
    const lock = readFileSync(join(folder, '.lock'), 'utf8');
    const state = readFileSync(join(folder, 'state.json'), 'utf8');
    loaded.draft.config.userName = 'other';
    saveSetup(prepareSetupSave(loaded));
    assert.equal(getConfig().userName, 'other');
    assert.equal(readFileSync(join(folder, '.lock'), 'utf8'), lock);
    assert.equal(readFileSync(join(folder, 'state.json'), 'utf8'), state);
    assert.equal(lockItem(42, 'competing').acquired, false);
  });

  for (const phase of ['reserved', 'running', 'stopping', 'recovery-needed'] as const) {
    it(`saves configuration without recovering or clearing a ${phase} worker`, () => {
      newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
      const owner = randomUUID();
      lockItem(42, owner);
      writeWorkerClaim(42, { schemaVersion: 1, itemId: 42, runId: owner, owner, sessionId: randomUUID(),
        host: hostname(), runnerPid: process.pid, childPid: null, phase, heartbeatAt: new Date().toISOString() });
      const folder = itemPath(42)!;
      const files = [join(folder, '.lock'), join(folder, 'session', 'active-run.json'), join(folder, 'state.json')];
      const before = files.map(f => readFileSync(f, 'utf8'));
      loaded.draft.config.maxQuestionsPerRound = 2;
      saveSetup(prepareSetupSave(loaded));
      assert.equal(getConfig().maxQuestionsPerRound, 2);
      assert.deepEqual(files.map(f => readFileSync(f, 'utf8')), before);
      assert.equal(lockItem(42, 'competing').acquired, false);
    });
  }

  it('does not treat corrupt existing settings as a new empty setup', () => {
    const settingsFile = join(newFolder(), 'settings.json');
    writeFileSync(settingsFile, '{bad');
    assert.throws(() => loadSetup({ ...loaded.paths, settingsFile }), { code: 'ASDF_SETUP_INVALID' });
  });

  it('rejects a v1 config when loading setup without rewriting it', () => {
    const file = join(loaded.draft.contextPath, 'asdf.config.json');
    const config = { ...loaded.draft.config, schemaVersion: 1 };
    const before = JSON.stringify(config);
    writeFileSync(file, before);
    assert.throws(() => loadSetup(loaded.paths), { code: 'ASDF_CONFIG_INVALID', message: /schemaVersion must be 2/ });
    assert.equal(readFileSync(file, 'utf8'), before);
  });

  it('rejects selecting a context with a v1 config', () => {
    const context = newFolder();
    const file = join(context, 'asdf.config.json');
    const before = JSON.stringify({ ...loaded.draft.config, schemaVersion: 1 });
    writeFileSync(file, before);
    assert.throws(() => selectContext(loaded, context), { code: 'ASDF_CONFIG_INVALID', message: /schemaVersion must be 2/ });
    assert.equal(readFileSync(file, 'utf8'), before);
  });

  it('rejects saving a v1 draft without writing files', () => {
    const file = join(loaded.draft.contextPath, 'asdf.config.json');
    const before = readFileSync(file, 'utf8');
    Object.assign(loaded.draft.config, { schemaVersion: 1 });
    assert.throws(() => prepareSetupSave(loaded), { code: 'ASDF_CONFIG_INVALID', message: /schemaVersion must be 2/ });
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(existsSync(loaded.paths.mcpFile), false);
  });

  it('switches context with active work while leaving old context and item files in place', () => {
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
    setItemRepo(42, 'Storage');
    lockItem(42, 'active');
    const folder = itemPath(42)!;
    const files = [join(folder, '.lock'), join(folder, 'state.json'), join(loaded.draft.contextPath, 'asdf.config.json')];
    const before = files.map(f => readFileSync(f, 'utf8'));
    const target = join(newFolder(), 'new-context');
    saveSetup(prepareSetupSave(selectContext(loaded, target)));
    assert.equal(contextPath(), target);
    assert.deepEqual(files.map(f => readFileSync(f, 'utf8')), before);
    assert.equal(existsSync(join(target, 'asdf.config.json')), true);
    assert.equal(existsSync(join(target, '42-work')), false);
  });

  it('removes an in-use organization and checkout without retaining or rewriting them', () => {
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
    setItemRepo(42, 'Storage');
    lockItem(42, 'active');
    const folder = itemPath(42)!;
    const before = readFileSync(join(folder, 'state.json'), 'utf8');
    const other = newWorkspace(join(newFolder(), 'Other'), 'https://dev.azure.com/fabrikam/Commerce/_git/Other');
    const workspace = loaded.draft.config.workspaces[0];
    loaded.draft.config.orgs = [{ org: 'fabrikam', projects: [{ project: 'Commerce', watchScopes: [{ kind: 'project', areaPaths: [] }] }] }];
    loaded.draft.config.workspaces = [{ ...workspace, path: other, name: 'Other', org: 'fabrikam', project: 'Commerce', repo: 'Other' }];
    saveSetup(prepareSetupSave(loaded));
    assert.deepEqual(getConfig().orgs.map((o: { org: string }) => o.org), ['fabrikam']);
    assert.deepEqual(getConfig().workspaces.map((w: { path: string }) => w.path), [other]);
    assert.equal(readFileSync(join(folder, 'state.json'), 'utf8'), before);
  });

  it('removes a tracked project instead of silently restoring its connection', () => {
    loaded.draft.config.orgs[0].projects.push({ project: 'Other', watchScopes: [{ kind: 'team', team: 'Team' }] });
    saveSetup(prepareSetupSave(loaded));
    loaded = loadSetup(loaded.paths);
    newItem({ id: 42, org: 'contoso', project: 'Other', kind: 'parent', type: 'User Story', title: 'Work' });
    loaded.draft.config.orgs[0].projects = loaded.draft.config.orgs[0].projects.filter(p => p.project !== 'Other');
    saveSetup(prepareSetupSave(loaded));
    assert.equal(getConfig().orgs[0].projects.some((p: { project: string }) => p.project === 'Other'), false);
  });

  it('does not inspect or repair item artifacts when saving setup', () => {
    const folder = join(loaded.draft.contextPath, '42-interrupted');
    mkdirSync(folder);
    const file = join(folder, 'state.json');
    writeFileSync(file, '{partial item write');
    loaded.draft.config.maxQuestionsPerRound = 2;
    saveSetup(prepareSetupSave(loaded));
    assert.equal(getConfig().maxQuestionsPerRound, 2);
    assert.equal(readFileSync(file, 'utf8'), '{partial item write');
  });

  it('preserves an external edit encountered during rollback', () => {
    loaded.draft.config.userName = 'newuser';
    const plan = prepareSetupSave(loaded);
    let count = 0;
    assert.throws(() => saveSetup(plan, { ...setupStore, replace: (path, content) => {
      if (++count === 2) {
        writeFileSync(loaded.paths.mcpFile, '{"mcpServers":{"external":{}}}');
        throw new Error('second write failed');
      }
      setupStore.replace(path, content);
    } }), { code: 'ASDF_SETUP_SAVE_FAILED', message: /partial rollback/ });
    assert.equal(readFileSync(loaded.paths.mcpFile, 'utf8'), '{"mcpServers":{"external":{}}}');
    assert.notEqual(getConfig().userName, 'newuser');
  });

  it('accepts an empty MCP config without overwriting unrelated root properties', () => {
    writeFileSync(loaded.paths.mcpFile, '{"note":"keep"}');
    const next = loadSetup(loaded.paths);
    loadSetupMcp(next);
    addMcpEntry(next.draft, 'contoso', 'ado-contoso');
    saveSetup(prepareSetupSave(next));
    const saved = JSON.parse(readFileSync(loaded.paths.mcpFile, 'utf8'));
    assert.equal(saved.note, 'keep');
    assert.equal(saved.mcpServers['ado-contoso'].type, 'http');
  });

  it('refuses to downgrade a newer personal settings schema', () => {
    const raw = JSON.parse(readFileSync(loaded.paths.settingsFile, 'utf8'));
    writeFileSync(loaded.paths.settingsFile, JSON.stringify({ ...raw, schemaVersion: 99 }));
    assert.throws(() => loadSetup(loaded.paths), { code: 'ASDF_SETUP_INVALID' });
  });

  it('does not lose a draft because Copilot updates advisory-only preferences', () => {
    const plan = prepareSetupSave(loaded);
    writeFileSync(loaded.paths.copilotSettingsFile, '{"theme":"dark"}');
    saveSetup(plan);
    assert.equal(readFileSync(loaded.paths.copilotSettingsFile, 'utf8'), '{"theme":"dark"}');
    assert.ok(existsSync(loaded.paths.mcpFile));
  });

  it('keeps draft values when a context path differs only in Windows casing', { skip: process.platform !== 'win32' }, () => {
    loaded.draft.config.userName = 'edited';
    assert.equal(selectContext(loaded, loaded.draft.contextPath.toUpperCase()).draft.config.userName, 'edited');
  });
});
