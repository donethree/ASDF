import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { newItem, setItemRepo } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { addMcpEntry, findMcpMatches, loadSetup, prepareSetupSave, saveSetup, selectContext, setupStore, type LoadedSetup } from '../scripts/lib/setupState.ts';
import { getConfig } from '../scripts/lib/settings.ts';
import { newContext, newFolder, newWorkspace } from './helpers.ts';

describe('offline setup persistence', () => {
  let loaded: LoadedSetup;
  beforeEach(() => {
    const ctx = newContext();
    loaded = loadSetup({ settingsFile: ctx.settings, mcpFile: join(dirname(ctx.settings), 'mcp.json'),
      copilotSettingsFile: join(dirname(ctx.settings), 'copilot.json') });
    addMcpEntry(loaded.draft, 'contoso', 'ado-contoso');
  });

  it('does not write a draft and preserves unrelated MCP data on confirmed save', () => {
    assert.equal(existsSync(loaded.paths.mcpFile), false);
    loaded.draft.mcp.unrelated = { keep: 'yes' };
    const plan = prepareSetupSave(loaded);
    assert.equal(existsSync(loaded.paths.mcpFile), false);
    saveSetup(plan);
    const mcp = JSON.parse(readFileSync(loaded.paths.mcpFile, 'utf8'));
    assert.equal(mcp.unrelated.keep, 'yes');
    assert.equal(mcp.mcpServers['ado-contoso'].headers['X-MCP-Insiders'], 'true');
    assert.equal(getConfig().schemaVersion, 2);
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

  it('refuses active work and disruptive changes with unfinished dependencies', () => {
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
    loaded.draft.config.userName = 'other';
    assert.throws(() => prepareSetupSave(loaded), { code: 'ASDF_SETUP_IN_USE' });
    loaded.draft.config.userName = loaded.originalConfig!.userName;
    lockItem(42, 'active');
    assert.throws(() => prepareSetupSave(loaded), { code: 'ASDF_SETUP_IN_USE' });
  });

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

  it('refuses context switching and removal of an unfinished item checkout', () => {
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
    setItemRepo(42, 'Storage');
    assert.throws(() => prepareSetupSave(selectContext(loaded, join(newFolder(), 'new-context'))), { code: 'ASDF_SETUP_IN_USE' });
    const other = newWorkspace(join(newFolder(), 'Other'), 'https://dev.azure.com/contoso/Storage/_git/Other');
    const workspace = loaded.draft.config.workspaces[0];
    loaded.draft.config.workspaces = [{ ...workspace, path: other, name: 'Other', repo: 'Other' }];
    assert.throws(() => prepareSetupSave(loaded), { code: 'ASDF_SETUP_IN_USE' });
  });

  it('retains an unwatched connection needed by an explicitly tracked item', () => {
    loaded.draft.config.orgs[0].projects.push({ project: 'Other', watchScopes: [{ kind: 'team', team: 'Team' }] });
    saveSetup(prepareSetupSave(loaded));
    loaded = loadSetup(loaded.paths);
    newItem({ id: 42, org: 'contoso', project: 'Other', kind: 'parent', type: 'User Story', title: 'Work' });
    loaded.draft.config.orgs[0].projects = loaded.draft.config.orgs[0].projects.filter(p => p.project !== 'Other');
    const plan = prepareSetupSave(loaded);
    assert.deepEqual(plan.draft.config.orgs[0].projects.find(p => p.project === 'Other'), { project: 'Other', watchScopes: [] });
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
