import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO, newFolder } from './helpers.ts';

const SCRIPT = join(REPO, 'skills', 'systematic-debugging', 'find-polluter.ts');

// A project with three test files; src/sub/b.test.cjs creates polluted.txt in the folder it runs from.
function newProject(): string {
  const project = newFolder('project');
  mkdirSync(join(project, 'src', 'sub'), { recursive: true });
  writeFileSync(join(project, 'src', 'a.test.cjs'), '');
  writeFileSync(join(project, 'src', 'sub', 'b.test.cjs'), "require('node:fs').writeFileSync('polluted.txt', '');\n");
  writeFileSync(join(project, 'src', 'c.test.cjs'), '');
  return project;
}

function findPolluter(project: string): { code: number | null; out: string } {
  const testCommand = `"${process.execPath}"`;
  const result = spawnSync(process.execPath, [SCRIPT, 'polluted.txt', 'src/**/*.test.cjs', testCommand], { cwd: project, encoding: 'utf8' });
  return { code: result.status, out: result.stdout };
}

describe('find-polluter', () => {
  it('names the test that creates the pollution', () => {
    const { code, out } = findPolluter(newProject());
    assert.equal(code, 1);
    assert.match(out, /Found 3 test files/);
    assert.match(out, /FOUND POLLUTER: src\/sub\/b\.test\.cjs/);
  });

  it('reports a clean run', () => {
    const project = newProject();
    rmSync(join(project, 'src', 'sub', 'b.test.cjs'));
    const { code, out } = findPolluter(project);
    assert.equal(code, 0);
    assert.match(out, /No polluter found/);
  });

  it('fails instead of claiming clean when pollution predates the run', () => {
    const project = newProject();
    writeFileSync(join(project, 'polluted.txt'), 'existing');
    const { code, out } = findPolluter(project);
    assert.equal(code, 2);
    assert.doesNotMatch(out, /all tests clean/);
  });

  it('fails when the test command cannot run', () => {
    const project = newProject();
    const result = spawnSync(process.execPath, [SCRIPT, 'polluted.txt', 'src/**/*.test.cjs', 'asdf-nonexistent-test-command'], {
      cwd: project, encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /all tests clean/);
  });

  it('does not call an empty test selection clean', () => {
    const result = spawnSync(process.execPath, [SCRIPT, 'polluted.txt', 'no-matches/*.cjs'], {
      cwd: newFolder(), encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout, /all tests clean/);
  });
});
