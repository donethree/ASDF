import { rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { artifactPath, atomicJson, check, object, optionalJson, text, time, uuid } from './artifacts.ts';
import { fail } from './util.ts';
import { withDirectoryGuard } from './localState.ts';

export type WorkerClaim = {
  schemaVersion: 1; itemId: number; runId: string; owner: string; sessionId: string;
  host: string; runnerPid: number; childPid: number | null;
  phase: 'reserved' | 'running' | 'stopping' | 'recovery-needed'; heartbeatAt: string;
};

// Synchronous, reentrant within this process; never hold across a child or model call.
export function withItemGuard<T>(id: number, action: () => T): T {
  return withDirectoryGuard(artifactPath(id, '.operation-guard'), action);
}

export function readWorkerClaim(id: number): WorkerClaim | null {
  const value = optionalJson(artifactPath(id, 'session', 'active-run.json'));
  if (value === null) return null;
  const v = object(value);
  check(v.schemaVersion === 1 && v.itemId === id && uuid(v.runId) && v.owner === v.runId && uuid(v.sessionId)
    && text(v.host) && typeof v.runnerPid === 'number' && Number.isSafeInteger(v.runnerPid) && v.runnerPid > 0
    && (v.childPid === null || (typeof v.childPid === 'number' && Number.isSafeInteger(v.childPid) && v.childPid > 0))
    && ['reserved', 'running', 'stopping', 'recovery-needed'].includes(String(v.phase)) && time(v.heartbeatAt), 'invalid active worker claim');
  return { schemaVersion: 1, itemId: id, runId: v.runId, owner: v.owner, sessionId: v.sessionId,
    host: v.host, runnerPid: v.runnerPid, childPid: v.childPid as number | null,
    phase: v.phase as WorkerClaim['phase'], heartbeatAt: v.heartbeatAt };
}

export function workerNeedsRecovery(claim: WorkerClaim): boolean {
  if (claim.phase === 'recovery-needed' || claim.host !== hostname()) return true;
  try { process.kill(claim.runnerPid, 0); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}

function requireOwner(id: number, owner: string): void {
  const value = optionalJson(artifactPath(id, '.lock'));
  if (!value || object(value).owner !== owner) fail('ASDF_LOCK_NOT_OWNER', `item ${id} is not held by ${owner}`);
}

export function writeWorkerClaim(id: number, claim: WorkerClaim): void {
  withItemGuard(id, () => {
    requireOwner(id, claim.owner);
    const existing = readWorkerClaim(id);
    if (existing && (existing.runId !== claim.runId || existing.owner !== claim.owner)) {
      fail('ASDF_LOCK_NOT_OWNER', `item ${id} already has a worker`);
    }
    check(claim.itemId === id && uuid(claim.runId) && claim.owner === claim.runId && uuid(claim.sessionId), 'invalid worker claim identity');
    atomicJson(artifactPath(id, 'session', 'active-run.json'), claim);
  });
}

export function removeWorkerClaim(id: number, runId: string, owner: string): void {
  withItemGuard(id, () => {
    requireOwner(id, owner);
    const claim = readWorkerClaim(id);
    if (!claim || claim.runId !== runId || claim.owner !== owner) fail('ASDF_LOCK_NOT_OWNER', 'worker claim changed');
    rmSync(artifactPath(id, 'session', 'active-run.json'));
  });
}
