import { appendFileSync, lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { STAGES } from './items.ts';
import { physical, withDirectoryGuard } from './localState.ts';
import { contextPath, validateContextPath } from './settings.ts';
import { fail } from './util.ts';

const ACTIONS = ['item-tracked', 'item-selected', 'item-deferred', 'state-changed', 'stage-finished', 'source-skipped', 'item-failed', 'pass-finished'] as const;
const OUTCOMES = ['completed', 'no-actionable-work', 'waiting', 'blocked', 'failed', 'deferred', 'incomplete', 'recovery-needed', 'no-progress'] as const;
export type AutomationAction = typeof ACTIONS[number];
export type AutomationOutcome = typeof OUTCOMES[number];
export type AutomationEvent = {
  passId: string; action: AutomationAction; itemId?: number;
  org?: string; project?: string; team?: string; stage?: string; from?: string; to?: string;
  outcome?: AutomationOutcome; reason?: string; errorCode?: string;
};
export type LogIssue = { code: string; message: string };
export type AutomationLogResult = { written: boolean; path: string | null; warnings: LogIssue[] };

function requireArgument(condition: unknown, message: string): asserts condition {
  if (!condition) fail('ASDF_BAD_ARGUMENT', message);
}
function normalizeEvent(input: unknown): AutomationEvent {
  requireArgument(input && typeof input === 'object' && !Array.isArray(input), 'automation event must be an object');
  const value = input as Record<string, unknown>;
  const allowed = ['passId', 'action', 'itemId', 'org', 'project', 'team', 'stage', 'from', 'to', 'outcome', 'reason', 'errorCode'];
  requireArgument(Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)), 'unsupported automation event field; session/payload fields are not accepted');
  requireArgument(typeof value.passId === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value.passId), 'PassId must be a 1-100 character identifier');
  requireArgument(ACTIONS.some(action => action === value.action), 'unrecognized automation action');
  const event: AutomationEvent = { passId: value.passId, action: value.action as AutomationAction };
  for (const field of ['org', 'project', 'team', 'reason', 'errorCode'] as const) {
    if (value[field] === undefined) continue;
    const text = value[field];
    const limit = field === 'reason' ? 240 : field === 'errorCode' ? 80 : 200;
    requireArgument(typeof text === 'string' && text.trim().length > 0 && text.length <= limit, `${field} must contain 1-${limit} characters`);
    if (field === 'errorCode') requireArgument(/^[A-Za-z0-9._:-]+$/.test(text), 'ErrorCode must be a short code, not raw error output');
    event[field] = text;
  }
  for (const field of ['stage', 'from', 'to'] as const) {
    if (value[field] === undefined) continue;
    const stage = value[field];
    requireArgument(typeof stage === 'string' && STAGES.some(s => s === stage), `${field} must be a recognized stage`);
    event[field] = stage;
  }
  if (value.itemId !== undefined) {
    requireArgument(typeof value.itemId === 'number' && Number.isSafeInteger(value.itemId) && value.itemId > 0, 'Id must be a positive integer');
    event.itemId = value.itemId;
  }
  if (value.outcome !== undefined) {
    requireArgument(OUTCOMES.some(outcome => outcome === value.outcome), 'unrecognized automation outcome');
    event.outcome = value.outcome as AutomationOutcome;
  }
  if (!['source-skipped', 'pass-finished'].includes(event.action)) requireArgument(event.itemId, 'this action requires Id');
  if (event.action === 'source-skipped') requireArgument(event.org, 'source-skipped requires Org');
  if (event.action === 'pass-finished') requireArgument(event.outcome, 'pass-finished requires Outcome');
  if (event.action === 'state-changed') requireArgument(event.from && event.to && event.from !== event.to, 'state-changed requires differing From/To stages');
  if (event.action === 'stage-finished') requireArgument(event.from && event.to && event.outcome, 'stage-finished requires From, To and Outcome');
  return event;
}

function quoted(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\u009f\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function format(event: AutomationEvent, at: Date): string {
  requireArgument(at instanceof Date && Number.isFinite(at.getTime()) && at.getUTCFullYear() >= 0 && at.getUTCFullYear() <= 9999, 'invalid log timestamp');
  const fields = [at.toISOString(), `pass=${event.passId}`, `action=${event.action}`];
  for (const key of ['org', 'project', 'team'] as const) if (event[key] !== undefined) fields.push(`${key}=${quoted(event[key]!)}`);
  if (event.itemId !== undefined) fields.push(`item=${event.itemId}`);
  for (const key of ['stage', 'from', 'to', 'outcome'] as const) if (event[key] !== undefined) fields.push(`${key}=${event[key]}`);
  if (event.reason !== undefined) fields.push(`reason=${quoted(event.reason)}`);
  if (event.errorCode !== undefined) fields.push(`error=${event.errorCode}`);
  const line = fields.join(' ') + '\n';
  requireArgument(Buffer.byteLength(line, 'utf8') <= 2048, 'automation log entry exceeds 2048 bytes');
  return line;
}
function checkPath(path: string, directory: boolean, optional: boolean): void {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
      fail('ASDF_AUTOMATION_LOG_PATH', `refusing a link or unexpected file type: ${path}`);
    }
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
function warning(code: string, error: unknown): LogIssue {
  return { code, message: error instanceof Error ? error.message : String(error) };
}
function prune(root: string, at: Date, warnings: LogIssue[]): void {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); }
  catch (error) { warnings.push(warning('ASDF_AUTOMATION_LOG_PRUNE_FAILED', error)); return; }
  const day = 86_400_000;
  const cutoff = at.getTime() - 5 * day;
  for (const entry of entries) {
    const match = /^automation-(\d{4}-\d{2}-\d{2})\.log$/.exec(entry.name);
    if (!match || !entry.isFile() || entry.isSymbolicLink()) continue;
    const date = new Date(`${match[1]}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[1] || date.getTime() + day > cutoff) continue;
    const path = join(root, entry.name);
    try {
      const stat = lstatSync(path);
      if (stat.isFile() && !stat.isSymbolicLink()) unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(warning('ASDF_AUTOMATION_LOG_PRUNE_FAILED', error));
    }
  }
}

export function recordAutomationEvent(input: unknown, at = new Date()): AutomationLogResult {
  const line = format(normalizeEvent(input), at);
  const result: AutomationLogResult = { written: false, path: null, warnings: [] };
  try {
    const root = physical(validateContextPath(contextPath()), 'ASDF_AUTOMATION_LOG_PATH');
    checkPath(root, true, false);
    result.path = join(root, `automation-${at.toISOString().slice(0, 10)}.log`);
    const guard = join(root, '.automation-log-guard');
    checkPath(guard, true, true);
    checkPath(result.path, false, true);
    const path = result.path;
    withDirectoryGuard(guard, () => {
      checkPath(path, false, true);
      prune(root, at, result.warnings);
      appendFileSync(path, Buffer.from(line, 'utf8'));
      result.written = true;
    });
  } catch (error) {
    result.warnings.push(warning(result.written ? 'ASDF_AUTOMATION_LOG_GUARD_FAILED' : 'ASDF_AUTOMATION_LOG_APPEND_FAILED', error));
  }
  return result;
}
