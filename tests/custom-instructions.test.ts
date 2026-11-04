import assert from 'node:assert/strict';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { newItem, setItemRepo } from '../scripts/lib/items.ts';
import { getConfig, setConfig } from '../scripts/lib/settings.ts';
import { newContext, newFolder, newWorkspace, runCli, type TestContext } from './helpers.ts';

describe('repository phase instructions', () => {
  let ctx: TestContext;
  let file: string;
  beforeEach(() => {
    ctx = newContext();
    newItem({ id: 401, org: 'contoso', project: 'Commerce', kind: 'parent', type: 'User Story', title: 'Orders' });
    setItemRepo(401, 'Storage');
    file = join(ctx.context, 'custom-instructions', 'org-contoso', 'project-storage', 'repo-storage', 'instructions.json');
  });
  const instructions = (phase = 'planning', id = 401) =>
    runCli('phase-instructions', '-Id', String(id), '-Phase', phase);
  const save = (value: unknown) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };

  it('keeps older installations working without creating a missing template at runtime', () => {
    const result = instructions();
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.path, file);
    assert.equal(result.json.exists, false);
    assert.equal(result.json.before, '');
    assert.equal(result.json.after, '');
    assert.equal(existsSync(file), false);
  });

  it('reads the recorded repository rather than the work item project and refreshes user edits', () => {
    save({ schemaVersion: 1, phases: { planning: { before: '', after: 'Use plan-review and incorporate feedback.\nKeep the scope.' } } });
    assert.equal(instructions().json.after, 'Use plan-review and incorporate feedback.\nKeep the scope.');
    save({ schemaVersion: 1, phases: { planning: { before: 'Read the revised spec.', after: '' } } });
    assert.equal(instructions().json.before, 'Read the revised spec.');
    assert.equal(instructions().json.after, '');
    assert.equal(instructions('implementation').json.before, '');
  });

  it('keeps repositories with identical names in different projects separate', () => {
    const other = newWorkspace(join(ctx.src, 'OtherStorage'), 'https://dev.azure.com/contoso/Other/_git/Storage');
    setConfig({ ...getConfig(), workspaces: [ctx.workspace, other] });
    newItem({ id: 402, org: 'contoso', project: 'Commerce', kind: 'parent', type: 'User Story', title: 'Other' });
    setItemRepo(402, 'Storage', 'contoso', 'Other');
    save({ schemaVersion: 1, phases: { planning: { before: 'Storage instructions', after: '' } } });
    const otherFile = join(ctx.context, 'custom-instructions', 'org-contoso', 'project-other', 'repo-storage', 'instructions.json');
    mkdirSync(dirname(otherFile), { recursive: true });
    writeFileSync(otherFile, JSON.stringify({ schemaVersion: 1, phases: { planning: { before: 'Other instructions', after: '' } } }));
    assert.equal(instructions().json.before, 'Storage instructions');
    assert.equal(instructions('planning', 402).json.before, 'Other instructions');
  });

  it('resolves a qualified configured repository before a Feature has a single repository', () => {
    save({ schemaVersion: 1, phases: { featureBreakdown: { before: 'Use the Storage breakdown reviewer.', after: '' } } });
    const result = runCli('phase-instructions', '-Org', 'CONTOSO', '-Project', 'Storage', '-Repo', 'storage', '-Phase', 'featureBreakdown');
    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.path, file);
    assert.equal(result.json.before, 'Use the Storage breakdown reviewer.');
  });

  it('rejects mixed, incomplete and unconfigured instruction identities', () => {
    for (const args of [
      ['-Id', '401', '-Org', 'contoso', '-Project', 'Storage', '-Repo', 'Storage'],
      ['-Org', 'contoso', '-Repo', 'Storage'],
      [],
    ]) {
      assert.equal(runCli('phase-instructions', '-Phase', 'planning', ...args).json.error, 'ASDF_BAD_ARGUMENT');
    }
    assert.equal(runCli('phase-instructions', '-Phase', 'planning', '-Org', 'contoso', '-Project', 'Other', '-Repo', 'Storage').json.error,
      'ASDF_NO_WORKSPACE');
  });

  it('reports invalid JSON, schemas and hook values instead of silently ignoring instructions', () => {
    for (const value of [
      null, { schemaVersion: 2, phases: {} }, { schemaVersion: 1, phases: [] },
      { schemaVersion: 1, phases: { planning: { before: true, after: '' } } },
      { schemaVersion: 1, phases: { planning: 'Use skill X' } },
      { schemaVersion: 1, phases: { plannning: { before: '', after: '' } } },
      { schemaVersion: 1, phases: { planning: { befor: 'Use skill X' } } },
    ]) {
      save(value);
      const result = instructions();
      assert.equal(result.code, 1, JSON.stringify(value));
      assert.equal(result.json.error, 'ASDF_CUSTOM_INSTRUCTIONS_INVALID');
      assert.ok(result.json.message.includes(file), result.json.message);
    }
    writeFileSync(file, '{invalid');
    assert.equal(instructions().json.error, 'ASDF_CUSTOM_INSTRUCTIONS_INVALID');
  });

  it('rejects unknown phases and items without a repository', () => {
    assert.equal(instructions('plannning').json.error, 'ASDF_BAD_ARGUMENT');
    newItem({ id: 403, org: 'contoso', project: 'Commerce', kind: 'parent', type: 'User Story', title: 'Unresolved' });
    assert.equal(instructions('planning', 403).json.error, 'ASDF_REPO_REQUIRED');
  });

  it('does not read instructions through a directory link into another location', () => {
    symlinkSync(newFolder('foreign-instructions'), join(ctx.context, 'custom-instructions'),
      process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(instructions().json.error, 'ASDF_CUSTOM_INSTRUCTIONS_INVALID');
  });
});
