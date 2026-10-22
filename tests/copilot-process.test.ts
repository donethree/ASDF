import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildCliInvocation, resolveCopilotExecutable, startCopilot } from '../scripts/lib/copilotProcess.ts';
import { newFolder } from './helpers.ts';
import { fakeExecutable, sessionFixture } from './session-fixtures.ts';

describe('CLI session transport', () => {
  it('creates by exact UUID and resumes without name or most-recent selection', () => {
    const { binding, request } = sessionFixture();
    const fresh = buildCliInvocation(request, binding, fakeExecutable(), 'create');
    assert.ok(fresh.args.includes('--session-id'));
    assert.ok(fresh.args.includes(binding.sessionId));
    const resume = buildCliInvocation(request, { ...binding, provisioning: 'confirmed' }, fakeExecutable(), 'resume');
    assert.ok(resume.args.includes('--resume'));
    assert.equal(resume.args.includes('--name'), false);
    assert.equal(resume.args.includes('--continue'), false);
    assert.equal(resume.cwd, request.artifactRoot);
    assert.ok(resume.args.includes('--no-ask-user'));
    assert.equal(resume.args.includes('--allow-all'), false);
  });

  for (const mode of ['success', 'chunked', 'nonzero', 'wrong-id', 'invalid', 'no-terminal', 'oversize']) {
    it(`handles ${mode} output without interpreting assistant success prose`, async () => {
      const { binding, request } = sessionFixture();
      const invocation = buildCliInvocation(request, binding, fakeExecutable(mode), 'create');
      const result = await startCopilot(invocation).result;
      if (['success', 'chunked'].includes(mode)) {
        assert.equal(result.error, null);
        assert.equal(result.terminal?.sessionId, binding.sessionId);
        assert.equal(result.skills[0].commandName, 'asdf:work-item');
      } else {
        assert.ok(result.error, mode);
      }
    });
  }

  it('preserves shell metacharacters as literal process arguments', async () => {
    const { binding, request } = sessionFixture();
    binding.name = 'export & echo WRONG %PATH% !, é';
    const invocation = buildCliInvocation(request, binding, fakeExecutable(), 'create');
    invocation.cwd = newFolder('space & percent% !, unicode-é');
    const result = await startCopilot(invocation).result;
    assert.equal(result.error, null);
    const exportPath = invocation.args[invocation.args.indexOf('--share') + 1];
    const observed = JSON.parse(readFileSync(exportPath, 'utf8'));
    assert.equal(observed.cwd, invocation.cwd);
    assert.ok(observed.args.includes(binding.name));
  });

  it('reports a missing executable without pretending a process started', async () => {
    const { binding, request } = sessionFixture();
    const invocation = buildCliInvocation(request, binding, { executable: join(newFolder(), 'missing'), prefixArgs: [] }, 'create');
    const result = await startCopilot(invocation).result;
    assert.equal(result.started, false);
    assert.equal(result.error?.code, 'ASDF_CLI_START_FAILED');
  });

  it('resolves a standard npm launcher without evaluating its shell text', () => {
    const folder = newFolder('npm');
    const pkg = join(folder, 'node_modules', '@github', 'copilot');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(folder, 'copilot.cmd'), 'echo DO-NOT-EXECUTE');
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ bin: { copilot: 'index.js' } }));
    writeFileSync(join(pkg, 'index.js'), '');
    assert.deepEqual(resolveCopilotExecutable({ PATH: folder }, 'win32'),
      { executable: process.execPath, prefixArgs: [realpathSync.native(join(pkg, 'index.js'))] });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ bin: { copilot: '../../escape.js' } }));
    assert.throws(() => resolveCopilotExecutable({ PATH: folder }, 'win32'), { code: 'ASDF_CLI_UNSUPPORTED' });
  });

  it('lets the process finish after malformed observation output', async () => {
    const { binding, request } = sessionFixture();
    const invocation = buildCliInvocation(request, binding, fakeExecutable('notice'), 'create');
    const result = await startCopilot(invocation).result;
    assert.equal(result.error?.code, 'ASDF_CLI_OUTPUT_INVALID');
    const exportPath = invocation.args[invocation.args.indexOf('--share') + 1];
    assert.ok(readFileSync(exportPath, 'utf8').length > 0);
    assert.equal(result.terminal?.sessionId, binding.sessionId);
  });

  it('recognizes an installed Windows app-execution alias', { skip: process.platform !== 'win32' }, (t) => {
    const folder = join(process.env.LOCALAPPDATA!, 'Microsoft', 'WindowsApps');
    const alias = join(folder, 'copilot.exe');
    try { lstatSync(alias); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { t.skip('Copilot app-execution alias not installed'); return; }
      throw error;
    }
    assert.equal(resolveCopilotExecutable({ PATH: folder }, 'win32').executable, alias);
  });
});
