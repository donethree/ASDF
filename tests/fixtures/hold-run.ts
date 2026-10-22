import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { artifactPath, atomicJson } from '../../scripts/lib/artifacts.ts';
import { lockItem } from '../../scripts/lib/lock.ts';
import { reserveBinding, runPath, writeRun, type WorkerRequest } from '../../scripts/lib/sessions.ts';
import { writeWorkerClaim } from '../../scripts/lib/workerLease.ts';

const owner = randomUUID();
lockItem(42, owner);
const binding = reserveBinding(42, owner);
const request: WorkerRequest = { schemaVersion: 1, backend: 'copilot-cli', item: binding.item,
  sessionId: binding.sessionId, runId: owner, owner, passId: 'crash-test', expectedStage: 'new',
  artifactRoot: artifactPath(42), mcpServer: 'ado-contoso',
  cli: { executable: process.execPath, script: fileURLToPath(new URL('../../scripts/asdf.ts', import.meta.url)) },
  pluginRoot: fileURLToPath(new URL('../..', import.meta.url)) };
writeRun(42, { schemaVersion: 1, request, state: 'starting', cliMode: 'create', startedAt: new Date().toISOString(),
  endedAt: null, host: hostname(), runnerPid: process.pid, childPid: null, termination: 'unknown',
  cliExitCode: null, finalStage: null, error: null, observationError: null });
atomicJson(runPath(42, owner, 'request.json'), request);
writeWorkerClaim(42, { schemaVersion: 1, itemId: 42, runId: owner, owner, sessionId: binding.sessionId,
  host: hostname(), runnerPid: process.pid, childPid: null, phase: 'reserved', heartbeatAt: new Date().toISOString() });
process.stdout.write(owner + '\n');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
