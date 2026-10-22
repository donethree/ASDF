// Lint for the plugin itself: manifests, license and credits, docs that must stay in sync with the code,
// skill frontmatter and links, and text that would only make sense in other agent harnesses.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { COMMANDS } from '../scripts/lib/cli.ts';
import { STAGES } from '../scripts/lib/items.ts';
import { REPO } from './helpers.ts';

const read = (path: string) => readFileSync(join(REPO, path), 'utf8');
const readJson = (path: string) => JSON.parse(read(path));
const filesIn = (folder: string) => readdirSync(join(REPO, folder), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
const skills = readdirSync(join(REPO, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

// Every file under a folder, skipping git internals and installed packages.
function walk(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === '.git' || entry.name === 'node_modules' ? [] : walk(path);
    return [path];
  });
}

function frontmatter(text: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const values: Record<string, string> = {};
  for (const line of block ? block[1].split(/\r?\n/) : []) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line);
    if (pair) values[pair[1]] = pair[2].trim().replace(/^"+|"+$/g, '');
  }
  return values;
}

// Text that belongs to other harnesses or to the Superpowers namespace, never to a Copilot-only plugin.
const FOREIGN = ['superpowers:', 'TodoWrite', 'AskUserQuestion', 'CLAUDE_PLUGIN_ROOT', 'Claude Code', 'Codex', 'OpenCode', 'Cursor', 'Gemini', '.superpowers/', 'docs/superpowers'];

describe('manifests', () => {
  it('plugin.json describes asdf', () => {
    const plugin = readJson('.plugin/plugin.json');
    assert.equal(plugin.name, 'asdf');
    assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
    assert.equal(plugin.skills, 'skills');
    assert.equal(plugin.hooks, 'hooks/hooks.json');
  });

  it('marketplace and package.json point at the plugin with the same version', () => {
    const { version } = readJson('.plugin/plugin.json');
    const marketplace = readJson('.plugin/marketplace.json');
    assert.equal(marketplace.name, 'asdf-dev');
    assert.deepEqual([marketplace.plugins[0].name, marketplace.plugins[0].source, marketplace.plugins[0].version], ['asdf', './', version]);
    assert.equal(readJson('package.json').version, version);
  });

  it('hooks.json runs both hooks with node, from every shell', () => {
    const { hooks } = readJson('hooks/hooks.json');
    for (const [event, file] of [['sessionStart', 'session-start.ts'], ['preToolUse', 'guard.ts']]) {
      const [hook] = hooks[event];
      assert.equal(hook.powershell, `node "$env:ASDF_PLUGIN_ROOT/hooks/${file}"`);
      assert.equal(hook.bash, `node "$ASDF_PLUGIN_ROOT/hooks/${file}"`);
      assert.equal(hook.env.ASDF_PLUGIN_ROOT, '${PLUGIN_ROOT}');
    }
    assert.equal(hooks.preToolUse[0].matcher, 'powershell|bash|.*repo_pull_request_write|.*start_process|.*interact_with_process');
  });

  it('needs nothing but Node: no PowerShell scripts and no runtime packages', () => {
    const scripts = walk(REPO).filter((path) => /\.(ps1|psm1|psd1)$/i.test(path));
    assert.deepEqual(scripts.map((path) => relative(REPO, path)), []);
    const pkg = readJson('package.json');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.dependencies, undefined);
  });

  it('is MIT-licensed like Superpowers, and keeps its copyright notice', () => {
    const license = read('LICENSE');
    assert.match(license, /^MIT License/);
    assert.match(license, /Copyright \(c\) 2026 ASDF contributors/);
    assert.match(license, /Copyright \(c\) 2025 Jesse Vincent/);
    assert.match(license, /Permission is hereby granted, free of charge/);
    assert.equal(readJson('.plugin/plugin.json').license, 'MIT');
    assert.equal(existsSync(join(REPO, 'THIRD-PARTY-NOTICES.md')), false);
  });

  it('credits Superpowers and Superlite at the top of the README', () => {
    const top = read('README.md').split(/\r?\n/).slice(0, 25).join('\n');
    assert.match(top, /https:\/\/github\.com\/obra\/superpowers/);
    assert.match(top, /https:\/\/github\.com\/iha2\/superlite/);
    assert.match(top, /Jesse Vincent/);
  });

  it('README describes the plugin and states the license', () => {
    const readme = read('README.md');
    for (const heading of ['Install', 'Daily use', 'Large work', 'automation', 'guard', 'License']) {
      assert.match(readme, new RegExp(`^#+\\s.*${heading}`, 'im'), heading);
    }
    assert.match(readme, /MIT/);
  });

  it('README states the minimum Node.js version that package.json requires', () => {
    const [major, minor] = readJson('package.json').engines.node.replace(/^>=/, '').split('.');
    assert.match(read('README.md'), new RegExp(`Node\\.js ${major}\\.${minor} or later`));
  });

  it('documents the Insiders header used by local MCP configuration', () => {
    assert.match(read('README.md'), /"headers": \{ "X-MCP-Insiders": "true" \}/);
  });

  it('writing-plans leaves splitting large work to the Feature breakdown', () => {
    assert.doesNotMatch(read('skills/writing-plans/SKILL.md'), /separate plans/);
  });

  it('the code check reads each workspace at the commit the deep dive read, through git', () => {
    const prompt = read('skills/brainstorming/code-check-prompt.md');
    assert.match(prompt, /\[COMMITS\]/);
    assert.match(prompt, /read through git/);
  });

  it('ARCHITECTURE.md links every skill, module and hook, and names every CLI command', () => {
    const architecture = read('ARCHITECTURE.md');
    const paths = [
      ...skills.map((skill) => `skills/${skill}/SKILL.md`),
      ...filesIn('scripts/lib').map((file) => `scripts/lib/${file}`),
      ...filesIn('hooks').map((file) => `hooks/${file}`),
      'scripts/asdf.ts',
      'asdf.js',
    ];
    for (const path of paths) assert.ok(architecture.includes(`](${path})`), `ARCHITECTURE.md should link ${path}`);
    const commands = Object.keys(COMMANDS);
    assert.ok(commands.length > 15);
    for (const command of commands) assert.ok(architecture.includes(`\`${command}\``), `ARCHITECTURE.md should name the CLI command ${command}`);
  });

  it('ARCHITECTURE.md links only existing files', () => {
    for (const link of read('ARCHITECTURE.md').matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)) {
      assert.ok(existsSync(join(REPO, link[1])), link[0]);
    }
  });

  it('ARCHITECTURE.md names every stage', () => {
    const architecture = read('ARCHITECTURE.md');
    for (const stage of STAGES) assert.ok(architecture.includes(`\`${stage}\``), `ARCHITECTURE.md should name the stage ${stage}`);
  });
});

for (const skill of skills) {
  describe(`skill ${skill}`, () => {
    const folder = join(REPO, 'skills', skill);
    const text = readFileSync(join(folder, 'SKILL.md'), 'utf8');

    it('has matching frontmatter', () => {
      const { name, description } = frontmatter(text);
      assert.equal(name, skill);
      assert.match(description, /^Use (only )?when/);
      assert.ok(description.length <= 1024);
    });

    it('references only existing skills', () => {
      for (const reference of text.matchAll(/asdf:([a-z0-9-]+)/g)) {
        assert.ok(existsSync(join(REPO, 'skills', reference[1], 'SKILL.md')), reference[0]);
      }
    });

    it('links only existing files', () => {
      for (const link of text.matchAll(/\]\(\.\/([^)#]+)\)/g)) assert.ok(existsSync(join(folder, link[1])), link[0]);
    });

    it('blocks an item only with a reason', () => {
      assert.doesNotMatch(text, /-Stage blocked`|`stage blocked`/i);
    });
  });
}

describe('Copilot-only text', () => {
  const docs = walk(join(REPO, 'skills'))
    .filter((path) => ['SKILL.md', 'templates.md'].includes(basename(path)) || path.endsWith('-prompt.md'))
    .concat([join(REPO, 'README.md'), join(REPO, 'ARCHITECTURE.md')]);
  for (const doc of docs) {
    it(`${relative(REPO, doc)} has no other harness or Superpowers namespace text`, () => {
      const text = readFileSync(doc, 'utf8');
      for (const foreign of FOREIGN) assert.ok(!text.includes(foreign), `contains '${foreign}'`);
    });
  }
});
