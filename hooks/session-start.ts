// sessionStart hook: injects the ASDF bootstrap (using-asdf) and its paths into every Copilot session.
// Prints exactly one JSON object and always exits 0; any failure falls back to the not-initialized text.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.ASDF_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const SETUP_COMMAND = `node "${join(root, 'asdf.js')}" --init`;
const NOT_INITIALIZED = `ASDF is not initialized. Run ${SETUP_COMMAND} manually before any ASDF work.`;

// The hook input isn't needed, but Copilot writes it, so read it to the end.
async function drainInput(): Promise<void> {
  if (process.stdin.isTTY) return;
  try {
    for await (const chunk of process.stdin) void chunk;
  } catch {
    // No input to read.
  }
}

async function contextLine(): Promise<string> {
  try {
    const settings = await import(pathToFileURL(join(root, 'scripts', 'lib', 'settings.ts')).href);
    const current = settings.getSettings();
    return current ? `asdf-context: ${current.contextPath}` : NOT_INITIALIZED;
  } catch {
    return NOT_INITIALIZED;
  }
}

// The using-asdf skill without its frontmatter.
function bootstrap(): string {
  try {
    const skill = readFileSync(join(root, 'skills', 'using-asdf', 'SKILL.md'), 'utf8');
    return skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  } catch {
    return '';
  }
}

await drainInput();
const lines = [
  'ASDF is active.',
  `ASDF plugin root: ${root}`,
  `ASDF CLI: node "${join(root, 'scripts', 'asdf.ts')}" <command>`,
  `ASDF setup: ${SETUP_COMMAND} (run manually in a terminal, not as a skill)`,
  await contextLine(),
  '',
  bootstrap(),
];
process.stdout.write(JSON.stringify({ additionalContext: lines.join('\n') }) + '\n');
