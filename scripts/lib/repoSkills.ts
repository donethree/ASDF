// Skills and agents a repo provides, found by kind (review, build, test).
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fail, readLines, same, type Json } from './util.ts';

const KIND_PATTERNS: Record<string, RegExp> = {
  review: /\breview/i,
  build: /\bbuild/i,
  test: /\b(unit )?tests?\b/i,
};

// The simple "key: value" lines of a Markdown file's frontmatter, keyed in lower case.
function frontmatter(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = readLines(path);
  if (lines.length === 0 || lines[0].trim() !== '---') return values;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (/^[>|][+-]?(?:\s+#.*)?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        block.push(lines[++i].trim());
      }
      value = block.join(value.startsWith('>') ? ' ' : '\n').trim();
    } else value = value.replace(/^["']+|["']+$/g, '');
    values[match[1].toLowerCase()] = value;
  }
  return values;
}

function entries(folder: string, directories: boolean): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => (directories ? entry.isDirectory() : entry.isFile()))
    .map((entry) => entry.name)
    .sort();
}

export function findRepoSkills(repoPath: string, kindName: string): Json[] {
  const kind = Object.keys(KIND_PATTERNS).find((k) => same(k, kindName));
  if (!kind) fail('ASDF_BAD_ARGUMENT', `-Kind must be review, build or test, not '${kindName}'`);
  const root = resolve(repoPath);
  const found: { name: string; description: string; path: string; type: string }[] = [];
  for (const folder of [join(root, '.github', 'skills'), join(root, '.agents', 'skills'), join(root, '.claude', 'skills')]) {
    for (const name of entries(folder, true)) {
      const file = join(folder, name, 'SKILL.md');
      if (!existsSync(file)) continue;
      const fm = frontmatter(file);
      found.push({ name: fm.name || name, description: fm.description ?? '', path: file, type: 'skill' });
    }
  }
  const agents = join(root, '.github', 'agents');
  for (const name of entries(agents, false).filter((n) => n.toLowerCase().endsWith('.md'))) {
    const file = join(agents, name);
    const fm = frontmatter(file);
    found.push({ name: fm.name || basename(name, name.slice(-3)).replace(/\.agent$/i, ''), description: fm.description ?? '', path: file, type: 'agent' });
  }
  return found
    .filter((skill) => KIND_PATTERNS[kind].test(`${skill.name} ${skill.description}`))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
