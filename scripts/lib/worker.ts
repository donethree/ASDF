import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactPath, atomicJson, check, text } from './artifacts.ts';
import { buildCliInvocation, checkCliCapabilities, resolveCopilotExecutable, startCopilot, type CliExecutable, type RunningCli } from './copilotProcess.ts';
import { getItem, getItems, managedChildReason, STAGE_PRIORITY } from './items.ts';
import { assertItemOwner, heartbeat, lockItem, unlockItem } from './lock.ts';
import { getConfig } from './settings.ts';
import { confirmBinding, listRuns, readAcknowledgement, readWorkerError, reserveBinding, runPath, writeRun,
  type ErrorInfo, type WorkerOutcome, type WorkerRequest, type WorkerRun } from './sessions.ts';
import { readWorkerClaim, removeWorkerClaim, withItemGuard, writeWorkerClaim } from './workerLease.ts';
import { AsdfError, fail } from './util.ts';
import { promoteTranscript, refreshSessionStatus } from './sessionStatus.ts';

export type WorkerDispatchResult = {
  itemId: number; runId: string | null; sessionId: string | null;
  status: 'completed' | 'deferred' | 'incomplete' | 'failed' | 'recovery-needed';
  fromStage: string; toStage: string; outcome: WorkerOutcome | null;
  error: ErrorInfo | null; observationError: ErrorInfo | null;
};
const info = (error: unknown): ErrorInfo => ({
  code: error instanceof AsdfError ? error.code : 'ASDF_WORKER_FAILED',
  message: error instanceof Error ? error.message : String(error),
});

export async function runWorker(input: { id: number; passId: string }, executable?: CliExecutable): Promise<WorkerDispatchResult> {
  const { id, passId } = input;
  const result: WorkerDispatchResult = { itemId: id, runId: null, sessionId: null, status: 'failed',
    fromStage: '', toStage: '', outcome: null, error: null, observationError: null };
  const owner = randomUUID();
  let acquired = false;
  let run: WorkerRun | null = null;
  let child: RunningCli | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let ownershipError: ErrorInfo | null = null;
  let heartbeatError: ErrorInfo | null = null;
  let cancelled = false;
  const stop = () => { cancelled = true; child?.terminate(); };
  try {
    if (process.env.ASDF_WORKER_REQUEST) fail('ASDF_WORKER_RECURSION', 'item workers cannot dispatch more item workers');
    check(Number.isSafeInteger(id) && id > 0 && text(passId), 'worker needs a positive item ID and pass ID');
    const initial = getItem(id);
    result.fromStage = result.toStage = String(initial.stage);
    if (managedChildReason(initial, getItems()) || !Object.hasOwn(STAGE_PRIORITY, initial.stage)) {
      result.status = 'deferred'; return result;
    }
    if (!lockItem(id, owner).acquired) { result.status = 'deferred'; return result; }
    acquired = true;
    const state = getItem(id);
    if (managedChildReason(state, getItems()) || !Object.hasOwn(STAGE_PRIORITY, state.stage)) {
      result.status = 'deferred'; return result;
    }
    const config = getConfig();
    const org = config.orgs.find((o: { org: string }) => o.org.toLowerCase() === String(state.org).toLowerCase());
    if (!org?.mcpServer) fail('ASDF_WORKER_MCP_UNAVAILABLE', 'work-item organization has no configured MCP server');
    withItemGuard(id, () => {
      const previous = listRuns(id);
      if (previous.some(r => !r.endedAt || r.termination === 'unknown')) {
        fail('ASDF_SESSION_RECOVERY_REQUIRED', 'an earlier run has unresolved process ownership');
      }
      const binding = reserveBinding(id, owner);
      const past = previous.filter(r => r.request.sessionId === binding.sessionId);
      const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
      const request: WorkerRequest = { schemaVersion: 1, backend: 'copilot-cli', item: binding.item,
        sessionId: binding.sessionId, runId: owner, owner, passId, expectedStage: state.stage,
        artifactRoot: artifactPath(id), mcpServer: org.mcpServer, pluginRoot,
        cli: { executable: process.execPath, script: resolve(pluginRoot, 'scripts', 'asdf.ts') } };
      run = { schemaVersion: 1, request, state: 'reserved', cliMode: binding.provisioning === 'confirmed' || past.some(r => r.termination !== 'not-started') ? 'resume' : 'create',
        startedAt: new Date().toISOString(), endedAt: null, host: hostname(), runnerPid: process.pid, childPid: null,
        termination: 'not-started', cliExitCode: null, finalStage: null, error: null, observationError: null };
      writeRun(id, run);
      atomicJson(runPath(id, owner, 'request.json'), request);
      writeWorkerClaim(id, { schemaVersion: 1, itemId: id, owner, runId: owner, sessionId: binding.sessionId,
        host: hostname(), runnerPid: process.pid, childPid: null, phase: 'reserved', heartbeatAt: new Date().toISOString() });
      result.runId = owner;
      result.sessionId = binding.sessionId;
    });
    // TypeScript does not track assignments inside the synchronous guard callback.
    const current = listRuns(id).find(r => r.request.runId === owner)!;
    run = current;
    const command = executable ?? resolveCopilotExecutable();
    checkCliCapabilities(command);
    const binding = reserveBinding(id, owner);
    run.state = 'starting';
    run.termination = 'unknown';
    writeRun(id, run);
    const invocation = buildCliInvocation(run.request, binding, command, run.cliMode);
    child = startCopilot(invocation);
    run.childPid = child.pid;
    run.state = 'running';
    writeRun(id, run);
    const claim = readWorkerClaim(id)!;
    writeWorkerClaim(id, { ...claim, childPid: child.pid, phase: 'running' });
    refreshSessionStatus(id, undefined, owner);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const interval = Math.max(1, Math.min(60_000, Number(config.lockStaleMinutes ?? 90) * 60_000 / 3));
    timer = setInterval(() => {
      try { heartbeat(id, owner); }
      catch (error) {
        if (error instanceof AsdfError && error.code === 'ASDF_LOCK_BUSY') return;
        if (error instanceof AsdfError && error.code === 'ASDF_LOCK_NOT_OWNER') ownershipError = info(error);
        else heartbeatError = info(error);
        child?.terminate();
      }
    }, interval);
    const exit = await child.result;
    clearInterval(timer);
    timer = undefined;
    if (ownershipError) {
      result.status = 'recovery-needed';
      result.error = ownershipError;
      return result;
    }
    assertItemOwner(id, owner);
    run.cliExitCode = exit.exitCode;
    run.termination = !exit.started ? 'not-started'
      : !cancelled && !exit.interrupted && !exit.signal ? 'closed' : 'unknown';
    run.error = heartbeatError ?? exit.error;
    if (exit.terminal?.sessionId === binding.sessionId) confirmBinding(id, owner, binding.sessionId);
    if (exit.terminal?.sessionId === binding.sessionId && exit.exitCode === 0 && !exit.error) {
      try { promoteTranscript(id, owner); }
      catch (error) { run.observationError = { code: 'ASDF_SESSION_EXPORT_FAILED', message: (error as Error).message }; }
    }
    if (run.termination === 'unknown') {
      run.state = 'recovery-needed';
      run.error ??= { code: 'ASDF_SESSION_RECOVERY_REQUIRED', message: 'worker termination is uncertain' };
    } else if (run.error) run.state = 'failed';
    else {
      const loaded = exit.skills.filter(s => s.commandName === 'asdf:work-item');
      if (loaded.length !== 1 || !loaded[0].enabled
        || resolve(loaded[0].path).toLowerCase() !== resolve(run.request.pluginRoot, 'skills', 'work-item', 'SKILL.md').toLowerCase()) {
        run.error = { code: 'ASDF_WORKER_SKILL_UNAVAILABLE', message: 'ASDF work-item skill was not enabled from the expected plugin' };
        run.state = 'failed';
      } else {
        run.error = readWorkerError(id, owner);
        const acknowledgement = readAcknowledgement(id, run);
        run.state = run.error ? 'failed' : acknowledgement ? 'completed' : 'incomplete';
        result.outcome = acknowledgement?.outcome ?? null;
        if (run.state === 'incomplete') run.error = { code: 'ASDF_WORKER_INCOMPLETE', message: 'CLI exited without a validated worker acknowledgement' };
      }
    }
  } catch (error) {
    result.error = info(error);
    if (result.error.code === 'ASDF_SESSION_RECOVERY_REQUIRED') result.status = 'recovery-needed';
    if (child && run?.termination === 'unknown') {
      child.terminate();
      await child.result;
    }
    if (run) {
      if (!child && error instanceof AsdfError && error.code === 'ASDF_CLI_START_FAILED') run.termination = 'not-started';
      run.error = info(error);
      run.state = run.termination === 'unknown' ? 'recovery-needed' : 'failed';
    }
  } finally {
    if (timer) clearInterval(timer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (acquired && !ownershipError) {
      try {
        withItemGuard(id, () => {
          assertItemOwner(id, owner);
          if (run) {
            run.endedAt = new Date().toISOString();
            run.finalStage = String(getItem(id).stage);
            writeRun(id, run);
            result.status = run.state === 'completed' ? 'completed' : run.state === 'incomplete' ? 'incomplete'
              : run.state === 'recovery-needed' ? 'recovery-needed' : 'failed';
            result.toStage = run.finalStage;
            result.error = run.error;
            result.observationError = run.observationError;
            if (run.termination === 'unknown') {
              writeWorkerClaim(id, { ...readWorkerClaim(id)!, phase: 'recovery-needed' });
            } else if (readWorkerClaim(id)) removeWorkerClaim(id, owner, owner);
            try { refreshSessionStatus(id, undefined, owner); }
            catch (error) {
              run.observationError = { code: 'ASDF_SESSION_STATUS_FAILED', message: (error as Error).message };
              result.observationError = run.observationError;
              writeRun(id, run);
            }
          }
          if (!readWorkerClaim(id)) unlockItem(id, owner);
        });
      } catch (error) {
        result.status = 'recovery-needed';
        result.error = info(error);
      }
    }
  }
  return result;
}
