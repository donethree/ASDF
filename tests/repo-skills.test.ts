import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { findRepoSkills } from '../scripts/lib/repoSkills.ts';
import { newFolder } from './helpers.ts';

describe('repo skills', () => {
  let repo: string;

  function addSkill(path: string, frontmatter: string) {
    const file = join(repo, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${frontmatter}\n---\n# body\n`);
  }

  const names = (skills: { name: string }[]) => skills.map((skill) => skill.name);

  before(() => {
    repo = join(newFolder(), 'repo');
    addSkill('.github/skills/code-review/SKILL.md', 'name: code-review\ndescription: Review C# changes for team conventions');
    addSkill('.github/skills/build/SKILL.md', 'name: build\ndescription: Build the projects with incremental detection');
    addSkill('.claude/skills/run-unit-tests/SKILL.md', 'name: run-unit-tests\ndescription: Run the unit tests for a class');
    addSkill('.github/agents/security-reviewer.agent.md', 'description: Reviews diffs for security issues');
    addSkill('.github/skills/docs/SKILL.md', 'name: docs\ndescription: Write documentation');
    addSkill('.agents/skills/worktree-setup/SKILL.md', 'name: worktree-setup\ndescription: Initialize linked worktrees for development');
    addSkill('.copilot/skills/bootstrap/SKILL.md', 'name: bootstrap\ndescription: Bootstrap the development workspace');
  });

  it('finds review skills and agents', () => {
    assert.deepEqual(names(findRepoSkills(repo, 'review')), ['security-reviewer', 'code-review']);
  });

  it('marks agents', () => {
    assert.equal(findRepoSkills(repo, 'review').find((skill) => skill.name === 'security-reviewer')?.type, 'agent');
  });

  it('finds build skills', () => {
    assert.deepEqual(names(findRepoSkills(repo, 'build')), ['build']);
  });

  it('finds test skills', () => {
    assert.deepEqual(names(findRepoSkills(repo, 'test')), ['run-unit-tests']);
  });

  it('finds repository worktree and workspace initialization skills before building', () => {
    assert.deepEqual(names(findRepoSkills(repo, 'worktree')), ['worktree-setup', 'bootstrap']);
  });

  it('finds nothing in a repo without skills', () => {
    assert.deepEqual(findRepoSkills(newFolder(), 'review'), []);
  });
});
