import { lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fail } from './util.ts';

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
export function stat(path: string) {
  try { return lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export function physical(path: string, errorCode: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  try {
    while (!stat(ancestor)) {
      const parent = dirname(ancestor);
      if (parent === ancestor) fail(errorCode, `cannot resolve ${path}`);
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
    return join(realpathSync.native(ancestor), ...suffix);
  } catch (error) {
    fail(errorCode, `cannot resolve ${path}: ${(error as Error).message}`);
  }
}
export function atomicText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' });
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}
export function atomicJson(path: string, value: unknown): void {
  atomicText(path, JSON.stringify(value, null, 2) + '\n');
}
export function optionalJson(path: string): unknown {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (value === null) fail('ASDF_SESSION_STATE_INVALID', `null is not a record: ${path}`);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    fail('ASDF_SESSION_STATE_INVALID', `cannot read ${path}: ${(error as Error).message}`);
  }
}
export function check(value: unknown, message: string): asserts value {
  if (!value) fail('ASDF_SESSION_STATE_INVALID', message);
}
export function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected a record');
  return value as Record<string, unknown>;
}
export const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const time = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));

const held = new Set<string>();
const pause = new Int32Array(new SharedArrayBuffer(4));
function removeEmpty(path: string): void {
  try { rmdirSync(path); }
  catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String((error as NodeJS.ErrnoException).code))) throw error;
  }
}
function reapDeadGuard(path: string): void {
  let names: string[];
  try { names = readdirSync(path); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) return;
    throw error;
  }
  if (names.length === 0) { removeEmpty(path); return; }
  if (names.length !== 1 || !uuid(names[0].replace(/\.json$/, ''))) return;
  const marker = join(path, names[0]);
  let value: unknown;
  try { value = JSON.parse(readFileSync(marker, 'utf8')); }
  catch (error) {
    // A competing Windows rename/removal may temporarily deny access. Leave
    // ownership unknown and retry acquisition; never reclaim on this evidence.
    if (['ENOENT', 'EACCES', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) return;
    fail('ASDF_LOCK_BUSY', `unreadable owner metadata: ${marker}`);
  }
  if (value === null) return;
  const v = object(value);
  if (v.host !== hostname() || typeof v.pid !== 'number' || !Number.isSafeInteger(v.pid) || v.pid <= 0) return;
  try { process.kill(v.pid, 0); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; }
  // Unique markers plus nonrecursive rmdir cannot remove a replacement holder.
  rmSync(marker, { force: true });
  removeEmpty(path);
}

export function withDirectoryGuard<T>(path: string, action: () => T): T {
  path = physical(path, 'ASDF_LOCK_BUSY');
  if (held.has(path)) return action();
  mkdirSync(dirname(path), { recursive: true });
  const token = randomUUID();
  const candidate = `${path}.candidate-${token}`;
  const marker = `${token}.json`;
  mkdirSync(candidate);
  atomicJson(join(candidate, marker), { pid: process.pid, host: hostname(), createdAt: new Date().toISOString() });
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      try { renameSync(candidate, path); acquired = true; break; }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EACCES', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) throw error;
        reapDeadGuard(path);
        Atomics.wait(pause, 0, 0, 10);
      }
    }
    if (!acquired) fail('ASDF_LOCK_BUSY', `busy or unverifiable local guard: ${path}`);
    held.add(path);
    return action();
  } finally {
    held.delete(path);
    const owned = acquired ? path : candidate;
    rmSync(join(owned, marker), { force: true });
    removeEmpty(owned);
  }
}
