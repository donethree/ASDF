import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { newFolder, newWorkspace, REPO } from './helpers.ts';

describe('public ASDF launcher', () => {
  const run = (...args: string[]) => {
    const home = newFolder('isolated-home');
    return { home, result: spawnSync(process.execPath, [join(REPO, 'asdf.js'), ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home, ASDF_SETTINGS: join(home, '.copilot', 'asdf', 'settings.json') },
      input: '', encoding: 'utf8',
    }) };
  };
  it('shows help and preserves JSON commands', () => {
    const help = run('--help').result;
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--init/);
    const settings = run('settings').result;
    assert.equal(settings.status, 0);
    assert.equal(JSON.parse(settings.stdout).initialized, false);
  });
  it('rejects conflicting init arguments and treats EOF as cancellation', () => {
    assert.equal(run('--init', 'settings').result.status, 1);
    const { home, result } = run('--init');
    assert.equal(result.status, 130, result.stderr);
    assert.equal(existsSync(join(home, '.copilot', 'asdf', 'settings.json')), false);
  });

  it('saves through the real line-input launcher using only isolated local files', () => {
    const home = newFolder('cli-home');
    const context = join(home, 'context');
    const repo = newWorkspace(join(home, 'Payments'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    const settings = join(home, '.copilot', 'asdf', 'settings.json');
    const answers = [context, '1', 'contoso', 'n', '1', 'contoso/Commerce', 'n',
      '1', repo, 'n', '1', 'contoso/Commerce', 'n', 'n', '4', 'jdoe', '', 'y', '1'];
    const result = spawnSync(process.execPath, [join(REPO, 'asdf.js'), '--init'], {
      env: { ...process.env, HOME: home, USERPROFILE: home, ASDF_SETTINGS: settings },
      input: answers.join('\n') + '\n', encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(readFileSync(settings, 'utf8')).contextPath, context);
    assert.equal(JSON.parse(readFileSync(join(context, 'asdf.config.json'), 'utf8')).userName, 'jdoe');
    assert.equal(JSON.parse(readFileSync(join(home, '.copilot', 'mcp-config.json'), 'utf8')).mcpServers['ado-contoso'].type, 'http');
  });
});
