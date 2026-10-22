// preToolUse hook: blocks ASDF's never-actions (force-push, pushing to main or outside the user's user/<userName>/ branches,
// az devops, REST to ADO, PR votes, policy bypass).
// Fails open on its own errors: a broken guard must never block every shell call in every session.
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const log = process.env.ASDF_HOOK_LOG || join(tmpdir(), 'asdf-hooks.log');

async function readInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
}

try {
  const root = process.env.ASDF_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
  const lib = (file: string) => import(pathToFileURL(join(root, 'scripts', 'lib', file)).href);
  const { guardDecision } = await lib('guard.ts');
  const { prop } = await lib('util.ts');
  const request = JSON.parse(await readInput());
  // No user name yet (or unreadable settings): the branch-prefix rule is off, the other rules still apply.
  let prefix: string | null = null;
  try {
    prefix = (await lib('settings.ts')).branchPrefix();
  } catch {
    prefix = null;
  }
  const reason = guardDecision(String(prop(request, 'toolName') ?? ''), prop(request, 'toolArgs'), prefix);
  if (reason) process.stdout.write(JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason }) + '\n');
} catch (error) {
  try {
    appendFileSync(log, `${new Date().toISOString()} guard error: ${(error as Error)?.message ?? String(error)}\n`);
  } catch {
    // Nowhere to log; still fail open.
  }
}
