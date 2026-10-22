import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { guardDecision } from '../scripts/lib/guard.ts';
import { copyPlugin, newContext, newFolder, runHook } from './helpers.ts';

const DENIED = /^ASDF guard:/;
const shell = (command: string, prefix: string | null = null) => guardDecision('powershell', { command }, prefix);

describe('guard decisions', () => {
  const alwaysDenied = [
    'git push --force origin user/jdoe/1-x', 'git push -f', 'git push --force-with-lease', 'git push origin +user/jdoe/1-x',
    'git push origin main', 'git push origin HEAD:main', 'git push origin HEAD:refs/heads/master',
    'git -C "C:\\src\\my repo" push origin main', 'git push --mirror', 'cd x; git push origin master',
    'az devops configure --defaults organization=x', 'az boards work-item show --id 1', 'az repos pr create',
    'Invoke-RestMethod https://dev.azure.com/contoso/_apis/wit/workitems/1',
    "$u='https://contoso.visualstudio.com/_apis'; irm $u", 'curl.exe -u :pat https://dev.azure.com/x/_apis/projects',
    'az rest --method get --url https://dev.azure.com/contoso/_apis/projects', 'az rest -u "https://contoso.visualstudio.com/_apis/wit/workitems/1"',
    'echo ASDF-GUARD-SELFTEST',
  ];
  for (const command of alwaysDenied) {
    it(`denies: ${command}`, () => assert.match(shell(command) ?? '', DENIED));
  }

  const allowed = [
    'git push -u origin user/jdoe/12345-add-csv-export', 'git push origin user/jdoe/7-main-menu', 'git checkout main',
    'git merge origin/main', 'git commit -m "force refresh of main cache"',
    'git clone https://contoso@dev.azure.com/contoso/Commerce/_git/repo', 'Invoke-RestMethod https://api.github.com', 'az account show',
    'az rest --url https://management.azure.com/subscriptions?api-version=2022-12-01',
  ];
  for (const command of allowed) {
    it(`allows: ${command}`, () => assert.equal(shell(command), null));
  }

  const prWrite = (args: unknown) => guardDecision('ado-contoso-repo_pull_request_write', args);

  const deniedPrWrites = [
    { action: 'vote', vote: 10 }, { action: ['vote'] }, { action: 'VOTE ' },
    { action: 'update', autoComplete: true, bypassPolicy: true, bypassReason: 'x' },
    { action: 'update', bypassPolicy: 'True' }, { action: 'update', bypassPolicy: 1 },
    { action: 'update', bypassPolicy: [true] }, { action: 'update', bypassPolicy: 'yes' },
  ];
  for (const args of deniedPrWrites) {
    it(`denies the PR write ${JSON.stringify(args)}`, () => assert.match(prWrite(args) ?? '', DENIED));
  }

  const allowedPrWrites = [
    { action: 'update', autoComplete: true, deleteSourceBranch: true, transitionWorkItems: false },
    { action: 'update', bypassPolicy: false }, { action: 'update', bypassPolicy: 'false' },
    { action: 'update', bypassPolicy: 0 }, { action: 'update', bypassPolicy: null },
  ];
  for (const args of allowedPrWrites) {
    it(`allows the PR write ${JSON.stringify(args)}`, () => assert.equal(prWrite(args), null));
  }

  it('allows other tools', () => {
    assert.equal(guardDecision('view', { path: 'x' }), null);
  });

  it('reads tool arguments given as a JSON string', () => {
    assert.match(guardDecision('powershell', '{"command":"git push --force"}') ?? '', DENIED);
  });

  it('reads a command given as a list of words, or as a bare JSON string', () => {
    assert.match(guardDecision('desktop-commander-start_process', { command: ['git', 'push', '--force'] }) ?? '', DENIED);
    assert.match(guardDecision('bash', JSON.stringify('git push --force')) ?? '', DENIED);
  });

  it('checks shell commands sent through MCP process tools', () => {
    assert.match(guardDecision('desktop-commander-start_process', { command: 'git push --force', timeout_ms: 5000 }) ?? '', DENIED);
    assert.match(guardDecision('desktop-commander-interact_with_process', { pid: 42, input: 'az repos pr list' }) ?? '', DENIED);
    assert.equal(guardDecision('desktop-commander-start_process', { command: 'git status', timeout_ms: 5000 }), null);
  });

  const outsidePrefix = [
    'git push origin feature/x', 'git push origin HEAD', 'git push', 'git push -u origin', 'git push origin :feature/x',
    'git push origin --delete feature/x', 'git push origin HEAD:refs/heads/feature/x', 'git push --follow-tags', 'git push origin USER/JDOE2/1-x',
  ];
  for (const command of outsidePrefix) {
    it(`with a branch prefix, denies a push outside it: ${command}`, () => assert.match(shell(command, 'user/jdoe') ?? '', /^ASDF guard:.*user\/jdoe\//));
  }

  const insidePrefix = [
    'git push -u origin user/jdoe/12345-add-csv-export', 'git -C "C:\\wt\\12345 x" push origin user/jdoe/12345-add-csv-export',
    'git push origin HEAD:user/jdoe/7-x', 'git push origin refs/heads/user/jdoe/7-x', 'git push origin --delete user/jdoe/7-x',
    'git push --tags', 'git push origin refs/tags/v1.0', 'git status',
  ];
  for (const command of insidePrefix) {
    it(`with a branch prefix, allows a push inside it: ${command}`, () => assert.equal(shell(command, 'user/jdoe'), null));
  }

  it('without a branch prefix, still allows a push it cannot place', () => {
    assert.equal(shell('git push'), null);
    assert.equal(shell('git push origin HEAD'), null);
  });
});

describe('guard hook', () => {
  let plugin: string;
  let noSettings: string;
  before(() => {
    plugin = copyPlugin();
    noSettings = join(newFolder(), 'no-settings.json');
  });

  const guard = (input: string, settings = noSettings) =>
    runHook(plugin, 'guard.ts', input, { ASDF_SETTINGS: settings, ASDF_HOOK_LOG: join(newFolder(), 'hook.log') });

  it('denies through the hook', () => {
    const { out } = guard('{"toolName":"powershell","toolArgs":"{\\"command\\":\\"git push --force\\"}"}');
    assert.equal(JSON.parse(out).permissionDecision, 'deny');
  });

  it('is silent when it allows', () => {
    assert.equal(guard('{"toolName":"bash","toolArgs":{"command":"git status"}}').out, '');
  });

  it('fails open on input it cannot read', () => {
    const { code, out } = guard('not json');
    assert.equal(code, 0);
    assert.equal(out, '');
  });

  it("enforces the configured user name's branch prefix", () => {
    const { settings } = newContext();
    const denied = guard('{"toolName":"powershell","toolArgs":{"command":"git push origin feature/x"}}', settings);
    assert.match(JSON.parse(denied.out).permissionDecisionReason, /user\/jdoe\//);
    assert.equal(guard('{"toolName":"powershell","toolArgs":{"command":"git push origin user/jdoe/1-x"}}', settings).out, '');
  });
});
