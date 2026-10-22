import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runSetup } from '../scripts/lib/setup.ts';
import { git, newFolder, newWorkspace } from './helpers.ts';

function scenario(answers: string[]) {
  let output = '';
  return { io: { write: (text: string) => { output += text; }, readLine: async () => answers.shift() ?? null },
    output: () => output, remaining: () => answers.length };
}
function paths(root: string) {
  return { settingsFile: join(root, 'profile', 'asdf', 'settings.json'),
    mcpFile: join(root, 'profile', 'mcp-config.json'), copilotSettingsFile: join(root, 'profile', 'settings.json') };
}

describe('numbered setup wizard', () => {
  it('adds multiple organizations, projects, repos and watches individually with examples', async () => {
    const root = newFolder();
    const context = join(root, 'context');
    const payments = newWorkspace(join(root, 'Payments, Legacy'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    const inventory = newWorkspace(join(root, 'Inventory'), 'https://dev.azure.com/fabrikam/Inventory/_git/Inventory');
    const script = scenario([
      context,
      '1', 'contoso', 'y', 'fabrikam', 'n',
      '1', 'contoso/Commerce', 'y', 'fabrikam/Inventory', 'n',
      '1', 'https://dev.azure.com/contoso/Commerce/_git/Payments', payments, 'y',
      'https://dev.azure.com/fabrikam/Inventory/_git/Inventory', inventory, 'n',
      '1', 'https://dev.azure.com/contoso/Commerce/_backlogs/backlog/Data%20Movement/Features?showParents=false', 'y',
      'fabrikam/Inventory', 'n', 'n',
      '4', 'jdoe',
      '', 'y', '', 'y',
      '1',
    ]);
    const result = await runSetup(script.io, paths(root));
    assert.equal(result.status, 'saved', script.output());
    assert.equal(script.remaining(), 0, script.output());
    const config = JSON.parse(readFileSync(join(context, 'asdf.config.json'), 'utf8'));
    assert.equal(config.schemaVersion, 2);
    assert.deepEqual(config.workspaces.map((w: { path: string }) => w.path), [payments, inventory]);
    assert.deepEqual(config.orgs[0].projects[0].watchScopes, [{ kind: 'team', team: 'Data Movement' }]);
    assert.deepEqual(config.orgs[1].projects[0].watchScopes, [{ kind: 'project', areaPaths: [] }]);
    for (const text of ['contoso =', 'Commerce =', '_git =', 'Payments =', 'Data%20Movement', 'showParents=false',
      'Add another organization?', 'Add another project?', 'Add another repository?', 'Add another backlog/watch source?',
      'already checked out', 'C:\\src\\Payments']) assert.ok(script.output().includes(text), text);
  });

  it('cancels on menu cancel or EOF without creating context/settings', async () => {
    for (const answers of [[], ['context', '0']]) {
      const root = newFolder();
      const context = join(root, 'context');
      const script = scenario(answers.map(a => a === 'context' ? context : a));
      assert.equal((await runSetup(script.io, paths(root))).status, 'cancelled');
      assert.equal(existsSync(context), false);
      assert.equal(existsSync(paths(root).settingsFile), false);
      assert.equal(existsSync(paths(root).mcpFile), false);
    }
  });

  it('keeps accepted entries when a later Add-another entry is rejected', async () => {
    const root = newFolder();
    const context = join(root, 'context');
    const repo = newWorkspace(join(root, 'Payments'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    const script = scenario([
      context,
      '1', 'contoso', 'y', 'contoso', '4',
      '1', 'contoso/Commerce', 'n',
      '1', repo, 'n',
      '1', 'contoso/Commerce', 'n', 'n',
      '4', 'jdoe', '', 'y', '1',
    ]);
    assert.equal((await runSetup(script.io, paths(root))).status, 'saved', script.output());
    assert.equal(JSON.parse(readFileSync(join(context, 'asdf.config.json'), 'utf8')).orgs.length, 1);
  });

  it('closes its input when existing setup cannot be loaded', async () => {
    const root = newFolder();
    let closed = false;
    const file = join(root, 'invalid-settings.json');
    const fs = await import('node:fs');
    fs.writeFileSync(file, '{bad');
    await assert.rejects(() => runSetup({ write: () => {}, readLine: async () => null, close: () => { closed = true; } },
      { ...paths(root), settingsFile: file }), { code: 'ASDF_SETUP_INVALID' });
    assert.equal(closed, true);
  });

  it('does not save a repository identity changed after the review was displayed', async () => {
    const root = newFolder();
    const context = join(root, 'context');
    const repo = newWorkspace(join(root, 'Payments'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    const script = scenario([context, '1', 'contoso', 'n', '1', 'contoso/Commerce', 'n',
      '1', repo, 'n', '1', 'contoso/Commerce', 'n', 'n', '4', 'jdoe', '', 'y', '1']);
    const read = script.io.readLine;
    script.io.readLine = async () => {
      if (script.output().includes('1) Save configuration')) {
        git('-C', repo, 'remote', 'set-url', 'origin', 'https://dev.azure.com/contoso/Commerce/_git/Other');
      }
      return read();
    };
    await assert.rejects(() => runSetup(script.io, paths(root)), { code: 'ASDF_SETUP_CONFLICT' });
    assert.equal(existsSync(paths(root).settingsFile), false);
  });

  it('edits and removes individual backlog entries from the final review', async () => {
    const root = newFolder();
    const context = join(root, 'context');
    const repo = newWorkspace(join(root, 'Payments'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    const team = (name: string) => `https://dev.azure.com/contoso/Commerce/_backlogs/backlog/${encodeURIComponent(name)}/Features`;
    const script = scenario([context, '1', 'contoso', 'n', '1', 'contoso/Commerce', 'n', '1', repo, 'n',
      '1', team('Old'), 'n', '4', 'jdoe', '', 'y',
      '6', '2', '1', team('Data Movement'), '1', team('Other'), 'y', team('Third'), 'n',
      '6', '3', '2', 'y', '4', '1']);
    assert.equal((await runSetup(script.io, paths(root))).status, 'saved', script.output());
    assert.deepEqual(JSON.parse(readFileSync(join(context, 'asdf.config.json'), 'utf8')).orgs[0].projects[0].watchScopes,
      [{ kind: 'team', team: 'Data Movement' }, { kind: 'team', team: 'Third' }]);
  });

  it('preserves draft changes when revisiting the unchanged Context section', async () => {
    const root = newFolder();
    const context = join(root, 'context');
    const repo = newWorkspace(join(root, 'Payments'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    const team = (name: string) => `https://dev.azure.com/contoso/Commerce/_backlogs/backlog/${name}/Features`;
    const first = scenario([context, '1', 'contoso', 'n', '1', 'contoso/Commerce', 'n', '1', repo, 'n',
      '1', team('Old'), 'n', '4', 'jdoe', '', 'y', '1']);
    assert.equal((await runSetup(first.io, paths(root))).status, 'saved');
    const edit = scenario(['', '4', '4', '4', '1', team('New'), 'n', '4', 'newuser', '2', '', '1']);
    assert.equal((await runSetup(edit.io, paths(root))).status, 'saved', edit.output());
    const saved = JSON.parse(readFileSync(join(context, 'asdf.config.json'), 'utf8'));
    assert.deepEqual(saved.orgs[0].projects[0].watchScopes,
      [{ kind: 'team', team: 'Old' }, { kind: 'team', team: 'New' }]);
    assert.equal(saved.userName, 'newuser');
  });

  it('offers the saved repository and checkout defaults when editing', async () => {
    const root = newFolder();
    const context = join(root, 'context');
    const repo = newWorkspace(join(root, 'Payments'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    const first = scenario([context, '1', 'contoso', 'n', '1', 'contoso/Commerce', 'n', '1', repo, 'n',
      '1', 'contoso/Commerce', 'n', 'n', '4', 'jdoe', '', 'y', '1']);
    assert.equal((await runSetup(first.io, paths(root))).status, 'saved');
    const edit = scenario(['', '4', '4', '2', '1', '', '', '4', '4', '4', '', '1']);
    assert.equal((await runSetup(edit.io, paths(root))).status, 'saved', edit.output());
    assert.ok(edit.output().includes(`[${repo}]`));
    assert.equal(JSON.parse(readFileSync(join(context, 'asdf.config.json'), 'utf8')).workspaces[0].path, repo);
  });
});
