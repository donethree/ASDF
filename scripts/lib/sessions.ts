import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readdirSync } from 'node:fs';
import { artifactPath, atomicJson, check, object, optionalJson, text, time, uuid } from './artifacts.ts';
import { getItem, STAGE_PRIORITY } from './items.ts';
import { assertItemOwner, lockItem, unlockItem } from './lock.ts';
import { readWorkerClaim, removeWorkerClaim, withItemGuard } from './workerLease.ts';
import { fail, now, same, stamp } from './util.ts';
import { withSettingsGuard } from './settings.ts';

export type ItemIdentity = { org: string; project: string; id: number; kind: 'parent' | 'task' | 'feature' };
export type WorkerOutcome = 'progressed' | 'waiting' | 'blocked' | 'deferred';
export type RunState = 'reserved' | 'starting' | 'running' | 'completed' | 'incomplete' | 'failed' | 'recovery-needed';
export type TerminationEvidence = 'not-started' | 'closed' | 'unknown';
export type ErrorInfo = { code: string; message: string };
export type SessionBinding = {
  schemaVersion: 1; backend: 'copilot-cli'; item: ItemIdentity; sessionId: string;
  name: string; createdAt: string; provisioning: 'reserved' | 'confirmed';
  previous: { sessionId: string; name: string; replacedAt: string; reason: string }[];
};
export type WorkerRequest = {
  schemaVersion: 1; backend: 'copilot-cli'; item: ItemIdentity; sessionId: string;
  runId: string; owner: string; passId: string; expectedStage: string;
  artifactRoot: string; mcpServer: string; cli: { executable: string; script: string }; pluginRoot: string;
};
export type WorkerAcknowledgement = {
  schemaVersion: 1; runId: string; owner: string; sessionId: string;
  outcome: WorkerOutcome; summary: string; finalStage: string;
};
export type WorkerRun = {
  schemaVersion: 1; request: WorkerRequest; state: RunState; cliMode: 'create' | 'resume';
  startedAt: string; endedAt: string | null; host: string; runnerPid: number; childPid: number | null;
  termination: TerminationEvidence; cliExitCode: number | null; finalStage: string | null;
  error: ErrorInfo | null; observationError: ErrorInfo | null;
};

export function identity(id: number): ItemIdentity {
  const item = getItem(id);
  check(text(item.org) && text(item.project) && ['parent', 'task', 'feature'].includes(item.kind), 'invalid work-item identity');
  return { id, org: item.org, project: item.project, kind: item.kind };
}

function validateIdentity(id: number, value: unknown): ItemIdentity {
  const v = object(value);
  const expected = identity(id);
  check(v.id === id && same(v.org, expected.org) && same(v.project, expected.project) && v.kind === expected.kind, 'work-item identity mismatch');
  return expected;
}

export function sessionPath(id: number, ...parts: string[]): string {
  return artifactPath(id, 'session', ...parts);
}

export function runPath(id: number, runId: string, file: string): string {
  check(uuid(runId), 'invalid run id');
  return sessionPath(id, 'runs', runId, file);
}

export function readBinding(id: number): SessionBinding | null {
  const value = optionalJson(sessionPath(id, 'binding.json'));
  if (value === null) return null;
  const v = object(value);
  const item = validateIdentity(id, v.item);
  check(v.schemaVersion === 1 && v.backend === 'copilot-cli' && uuid(v.sessionId) && text(v.name)
    && time(v.createdAt) && (v.provisioning === 'reserved' || v.provisioning === 'confirmed') && Array.isArray(v.previous), 'invalid session binding');
  const previous = v.previous.map((entry: unknown) => {
    const p = object(entry);
    check(uuid(p.sessionId) && text(p.name) && time(p.replacedAt) && text(p.reason), 'invalid previous session');
    return { sessionId: p.sessionId, name: p.name, replacedAt: p.replacedAt, reason: p.reason };
  });
  return { schemaVersion: 1, backend: 'copilot-cli', item, sessionId: v.sessionId, name: v.name, createdAt: v.createdAt, provisioning: v.provisioning, previous };
}

export function reserveBinding(id: number, owner: string): SessionBinding {
  return withItemGuard(id, () => {
  assertItemOwner(id, owner);
  const existing = readBinding(id);
  if (existing) return existing;
  const item = identity(id);
  const state = getItem(id);
  const binding: SessionBinding = {
    schemaVersion: 1, backend: 'copilot-cli', item, sessionId: randomUUID(),
    name: `ASDF | ${item.org}/${item.project} | ${state.type} ${id} | ${state.title}`,
    createdAt: stamp(now()), provisioning: 'reserved', previous: [],
  };
  atomicJson(sessionPath(id, 'binding.json'), binding);
  return binding;
  });
}

export function confirmBinding(id: number, owner: string, sessionId: string): SessionBinding {
  return withItemGuard(id, () => {
  assertItemOwner(id, owner);
  const binding = readBinding(id);
  check(binding && binding.sessionId === sessionId, 'session identity mismatch');
  binding.provisioning = 'confirmed';
  atomicJson(sessionPath(id, 'binding.json'), binding);
  return binding;
  });
}

export function validateRequest(id: number, value: unknown): WorkerRequest {
  const v = object(value);
  const item = validateIdentity(id, v.item);
  const cli = object(v.cli);
  check(v.schemaVersion === 1 && v.backend === 'copilot-cli' && uuid(v.sessionId) && uuid(v.runId)
    && v.owner === v.runId && text(v.passId) && text(v.expectedStage) && text(v.artifactRoot)
    && v.artifactRoot === artifactPath(id) && text(v.mcpServer) && text(v.pluginRoot)
    && text(cli.executable) && text(cli.script), 'invalid worker request');
  return { schemaVersion: 1, backend: 'copilot-cli', item, sessionId: v.sessionId, runId: v.runId, owner: v.owner,
    passId: v.passId, expectedStage: v.expectedStage, artifactRoot: v.artifactRoot, mcpServer: v.mcpServer,
    cli: { executable: cli.executable, script: cli.script }, pluginRoot: v.pluginRoot };
}

function errorInfo(value: unknown): ErrorInfo | null {
  if (value === null) return null;
  const v = object(value);
  check(text(v.code) && typeof v.message === 'string', 'invalid error record');
  return { code: v.code, message: v.message };
}

export function readRun(id: number, runId: string): WorkerRun | null {
  const value = optionalJson(runPath(id, runId, 'run.json'));
  if (value === null) return null;
  const v = object(value);
  const request = validateRequest(id, v.request);
  check(request.runId === runId && v.schemaVersion === 1
    && ['reserved', 'starting', 'running', 'completed', 'incomplete', 'failed', 'recovery-needed'].includes(String(v.state))
    && (v.cliMode === 'create' || v.cliMode === 'resume') && text(v.host) && time(v.startedAt) && (v.endedAt === null || time(v.endedAt))
    && typeof v.runnerPid === 'number' && Number.isSafeInteger(v.runnerPid) && v.runnerPid > 0
    && (v.childPid === null || (typeof v.childPid === 'number' && Number.isSafeInteger(v.childPid) && v.childPid > 0))
    && ['not-started', 'closed', 'unknown'].includes(String(v.termination))
    && (v.cliExitCode === null || Number.isInteger(v.cliExitCode))
    && (v.finalStage === null || text(v.finalStage)), 'invalid worker run');
  return { schemaVersion: 1, request, state: v.state as RunState, cliMode: v.cliMode,
    startedAt: v.startedAt, endedAt: v.endedAt, host: v.host, runnerPid: v.runnerPid, childPid: v.childPid as number | null,
    termination: v.termination as TerminationEvidence, cliExitCode: v.cliExitCode as number | null,
    finalStage: v.finalStage, error: errorInfo(v.error), observationError: errorInfo(v.observationError) };
}

export function writeRun(id: number, run: WorkerRun): void {
  withItemGuard(id, () => {
    assertItemOwner(id, run.request.owner);
    validateRequest(id, run.request);
    atomicJson(runPath(id, run.request.runId, 'run.json'), run);
  });
}

export function listRuns(id: number): WorkerRun[] {
  let names: string[];
  try { names = readdirSync(sessionPath(id, 'runs')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names.filter(uuid).map((name) => {
    const run = readRun(id, name);
    check(run, `missing run record: ${name}`);
    return run;
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.request.runId.localeCompare(a.request.runId));
}

  export function validateWorkerRequest(id: number, runId: string, owner: string): WorkerRequest {
    return withItemGuard(id, () => {
      assertItemOwner(id, owner);
      const claim = readWorkerClaim(id);
      const binding = readBinding(id);
      const run = readRun(id, runId);
      const request = validateRequest(id, optionalJson(runPath(id, runId, 'request.json')));
      check(claim && binding && run && claim.runId === runId && claim.owner === owner && request.owner === owner
        && request.runId === runId && request.sessionId === binding.sessionId && claim.sessionId === binding.sessionId
        && JSON.stringify(run.request) === JSON.stringify(request) && run.state === 'running'
        && claim.phase === 'running', 'stale or mismatched worker request');
      return request;
    });
  }

  export function completeWorker(id: number, runId: string, owner: string, result: unknown): WorkerAcknowledgement {
    return withItemGuard(id, () => {
      const request = validateWorkerRequest(id, runId, owner);
      const v = object(result);
      check(v.sessionId === request.sessionId && ['progressed', 'waiting', 'blocked', 'deferred'].includes(String(v.outcome))
        && text(v.summary), 'invalid worker completion');
      const stage = String(getItem(id).stage);
      check(v.outcome !== 'blocked' || stage === 'blocked', 'blocked outcome needs blocked state');
      check(v.outcome !== 'waiting' || (!Object.hasOwn(STAGE_PRIORITY, stage) && stage !== 'done' && stage !== 'blocked'), 'waiting outcome needs waiting state');
      check(v.outcome !== 'progressed' || stage !== request.expectedStage, 'progressed outcome needs a stage change');
      const acknowledgement: WorkerAcknowledgement = { schemaVersion: 1, runId, owner, sessionId: request.sessionId,
        outcome: v.outcome as WorkerOutcome, summary: v.summary, finalStage: stage };
      check(optionalJson(runPath(id, runId, 'worker-error.json')) === null, 'worker already reported failure');
      atomicJson(runPath(id, runId, 'worker-result.json'), acknowledgement);
      return acknowledgement;
    });
  }

  export function failWorker(id: number, runId: string, owner: string, result: unknown): ErrorInfo {
    return withItemGuard(id, () => {
      validateWorkerRequest(id, runId, owner);
      const v = object(result);
      check(text(v.code) && /^ASDF_[A-Z_]+$/.test(v.code) && text(v.message), 'invalid worker failure');
      check(optionalJson(runPath(id, runId, 'worker-result.json')) === null, 'worker already acknowledged completion');
      const error = { code: v.code, message: v.message };
      atomicJson(runPath(id, runId, 'worker-error.json'), error);
      return error;
    });
  }

  export function readAcknowledgement(id: number, run: WorkerRun): WorkerAcknowledgement | null {
    const value = optionalJson(runPath(id, run.request.runId, 'worker-result.json'));
    if (value === null) return null;
    const v = object(value);
    check(v.schemaVersion === 1 && v.runId === run.request.runId && v.owner === run.request.owner && v.sessionId === run.request.sessionId
      && ['progressed', 'waiting', 'blocked', 'deferred'].includes(String(v.outcome)) && text(v.summary)
      && v.finalStage === getItem(id).stage, 'invalid or outdated acknowledgement');
    return { schemaVersion: 1, runId: run.request.runId, owner: run.request.owner, sessionId: run.request.sessionId,
      outcome: v.outcome as WorkerOutcome, summary: v.summary, finalStage: String(v.finalStage) };
  }

  export function readWorkerError(id: number, runId: string): ErrorInfo | null {
    return errorInfo(optionalJson(runPath(id, runId, 'worker-error.json')));
  }

  export function recoverSession(id: number, runId: string, action: 'retry' | 'replace', reason: string, processesStopped = false): SessionBinding {
    check((action === 'retry' || action === 'replace') && text(reason), 'recovery needs retry/replace and a reason');
    if (process.env.ASDF_WORKER_REQUEST) fail('ASDF_WORKER_RECURSION', 'a worker cannot recover its own session');
    return withSettingsGuard(() => withItemGuard(id, () => {
      const run = readRun(id, runId);
      const binding = readBinding(id);
      const latest = listRuns(id)[0];
      const claim = readWorkerClaim(id);
      check(run && binding && latest?.request.runId === runId && run.request.sessionId === binding.sessionId, 'recovery must name the latest run of this conversation');
      const uncertain = run.termination === 'unknown' || !run.endedAt;
      if (uncertain && !processesStopped) fail('ASDF_SESSION_RECOVERY_REQUIRED', 'verify all worker descendants have stopped, then explicitly supply -ProcessesStopped true and a reason');
      if (claim || uncertain) {
        check(!claim || claim.runId === runId, 'another run is active');
        if (run.host !== hostname() || (claim && claim.host !== hostname())) fail('ASDF_SESSION_RECOVERY_REQUIRED', 'recover on the recorded host');
        for (const pid of [run.runnerPid, run.childPid]) {
          if (pid === null) continue;
          try { process.kill(pid, 0); fail('ASDF_SESSION_RECOVERY_REQUIRED', 'a recorded process is still alive'); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
        }
      }
      const recoveryOwner = run.request.owner;
      if (!lockItem(id, recoveryOwner).acquired) fail('ASDF_LOCK_BUSY', 'item is held by another operation');
      try {
        atomicJson(runPath(id, runId, 'recovery.json'), { action, reason, at: stamp(now()), sessionId: binding.sessionId, processesStopped });
        if (uncertain) {
          run.termination = 'closed';
          run.endedAt = new Date().toISOString();
          run.state = 'failed';
          run.error ??= { code: 'ASDF_WORKER_INTERRUPTED', message: 'Operator verified termination after interrupted run' };
          writeRun(id, run);
        }
        if (action === 'replace') {
          binding.previous.push({ sessionId: binding.sessionId, name: binding.name, replacedAt: stamp(now()), reason });
          binding.sessionId = randomUUID();
          binding.createdAt = stamp(now());
          binding.provisioning = 'reserved';
          atomicJson(sessionPath(id, 'binding.json'), binding);
        }
        if (claim) removeWorkerClaim(id, runId, recoveryOwner);
        return binding;
      } finally { unlockItem(id, recoveryOwner); }
    }));
  }
