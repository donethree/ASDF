import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { newContext, newFolder, runCli, uninitialized } from './helpers.ts';

const NEW_PBI = ['-Org', 'contoso', '-Project', 'Storage', '-Kind', 'parent', '-Type', 'Product Backlog Item'];

describe('the CLI', () => {
  it('reports an install that is not initialized', () => {
    uninitialized();
    const { code, json } = runCli('settings');
    assert.equal(code, 0);
    assert.equal(json.initialized, false);
  });

  it('runs an item through its first stages, with a context path that has spaces', () => {
    uninitialized();
    const folder = newFolder();
    const context = join(folder, 'ctx with space');
    assert.equal(runCli('settings-set', '-ContextPath', context).code, 0);

    assert.equal(runCli('item-new', ...NEW_PBI, '-Id', '42', '-Title', 'Add CSV export').json.stage, 'tracked');
    assert.equal(runCli('item', '-id', '42').json.path, join(context, '42-add-csv-export'));

    const signals = join(folder, 'signals.json');
    writeFileSync(signals, JSON.stringify({ workItem: { stateCategory: 'InProgress', assignedToMe: true } }));
    assert.equal(runCli('signals', '-Id', '42', '-File', signals).json.to, 'new');

    const patch = join(folder, 'patch.json');
    writeFileSync(patch, JSON.stringify({ ado: { hldId: 43 } }));
    assert.equal(runCli('item-set', '-Id', '42', '-File', patch).json.ado.hldId, 43);

    assert.equal(runCli('queue').json.length, 1);
    assert.deepEqual(runCli('items', '-Stage', 'new,approved').json.map((item: { id: number }) => item.id), [42]);
  });

  it('prints a JSON error and exits 1', () => {
    uninitialized();
    runCli('settings-set', '-ContextPath', join(newFolder(), 'ctx'));
    const missing = runCli('item', '-Id', '999');
    assert.equal(missing.code, 1);
    assert.deepEqual(missing.json, { error: 'ASDF_ITEM_NOT_FOUND', message: '999' });
    assert.equal(runCli('bogus').json.error, 'ASDF_UNKNOWN_COMMAND');
  });

  it('reports a missing or malformed argument instead of guessing', () => {
    uninitialized();
    runCli('settings-set', '-ContextPath', join(newFolder(), 'ctx'));
    assert.deepEqual(runCli('item').json, { error: 'ASDF_MISSING_ARGUMENT', message: '-Id' });
    assert.equal(runCli('item', '-Id').json.error, 'ASDF_MISSING_ARGUMENT');
    assert.equal(runCli('item', '-Id', 'abc').json.error, 'ASDF_BAD_ARGUMENT');
    assert.equal(runCli('item', 'Id', '1').json.error, 'ASDF_BAD_ARGUMENT');
    assert.equal(runCli('item', '-Id', '1', '-Color', 'red').json.error, 'ASDF_BAD_ARGUMENT');
    assert.equal(runCli('item', '-Id', '1', '-File', 'x.json').json.message, 'item does not take -File');
  });

  it("records an item's repo from a workspace", () => {
    const ctx = newContext();
    runCli('item-new', ...NEW_PBI, '-Id', '9', '-Title', 'Z');
    const recorded = runCli('item-repo', '-Id', '9', '-Name', 'Storage');
    assert.equal(recorded.code, 0);
    assert.equal(recorded.json.repo.clonePath, ctx.workspace);
    assert.equal(runCli('item-repo', '-Id', '9', '-Name', 'Nope').json.error, 'ASDF_NO_WORKSPACE');
  });

  it('records an operational event without changing workflow state', () => {
    const ctx = newContext();
    runCli('item-new', ...NEW_PBI, '-Id', '42', '-Title', 'Logging target');
    const item = runCli('item', '-Id', '42').json;
    const beforeState = readFileSync(join(item.path, 'state.json'), 'utf8');
    const beforeConfig = readFileSync(join(ctx.context, 'asdf.config.json'), 'utf8');
    const result = runCli('automation-log', '-PassId', 'pass-a', '-Action', 'item-selected', '-Id', '42',
      '-Org', 'contoso', '-Project', 'Storage', '-Stage', 'new', '-Reason', 'queue priority');
    assert.equal(result.code, 0);
    assert.equal(result.json.written, true);
    const log = readFileSync(result.json.path, 'utf8');
    assert.match(log, /pass=pass-a action=item-selected org="contoso" project="Storage" item=42 stage=new reason="queue priority"/);
    assert.equal(readFileSync(join(item.path, 'state.json'), 'utf8'), beforeState);
    assert.equal(readFileSync(join(ctx.context, 'asdf.config.json'), 'utf8'), beforeConfig);
    assert.equal(runCli('automation-log', '-PassId', 'a', '-Action', 'pass-finished', '-Outcome', 'completed', '-SessionId', 'not-allowed').json.error, 'ASDF_BAD_ARGUMENT');
  });

  it('reports an unavailable log destination without turning it into an item failure', () => {
    const ctx = newContext();
    writeFileSync(join(ctx.context, '.automation-log-guard'), 'not a directory');
    const result = runCli('automation-log', '-PassId', 'pass-a', '-Action', 'pass-finished', '-Outcome', 'no-actionable-work');
    assert.equal(result.code, 1);
    assert.equal(result.json.written, false);
    assert.equal(result.json.warnings[0].code, 'ASDF_AUTOMATION_LOG_APPEND_FAILED');
    assert.deepEqual(runCli('items').json, []);
  });
});
