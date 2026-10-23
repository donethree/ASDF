import { renameSync, statSync } from 'node:fs';
import { atomicJson, atomicText, check, object, optionalJson, text, time } from './artifacts.ts';
import { getItem } from './items.ts';
import { identity, listRuns, readBinding, runPath, sessionPath,
  type ErrorInfo, type ItemIdentity, type SessionBinding, type WorkerRun } from './sessions.ts';
import { readWorkerClaim, withItemGuard, workerNeedsRecovery } from './workerLease.ts';
import { fail } from './util.ts';
import { assertLiveMutation, readLiveWatch, type LiveWatch } from './liveWatch.ts';

export type SessionStatus = {
  schemaVersion: 1; item: ItemIdentity; title: string; stage: string;
  observedAt: string; lastSyncedAt: string | null; binding: SessionBinding | null; latestRun: WorkerRun | null;
  waiting: { reason: string; targetUrl: string | null } | null;
  transcriptPath: string | null; transcriptExportedAt: string | null;
  liveEventsPath: string | null; error: ErrorInfo | null;
  liveWatch: LiveWatch | null;
};

export function getSessionStatus(id: number): SessionStatus {
  const item = getItem(id);
  const binding = readBinding(id);
  const runs = binding ? listRuns(id) : [];
  const claim = readWorkerClaim(id);
  const latestRun = (claim ? runs.find(r => r.request.runId === claim.runId) : runs[0]) ?? null;
  let lastSyncedAt: string | null = null;
  const prior = optionalJson(sessionPath(id, 'status.json'));
  if (prior !== null) {
    const v = object(prior);
    check(v.schemaVersion === 1 && (v.lastSyncedAt === null || time(v.lastSyncedAt)), 'invalid session status');
    lastSyncedAt = v.lastSyncedAt;
  }
  const enc = (v: unknown) => encodeURIComponent(String(v));
  const workUrl = (target: unknown) => Number.isSafeInteger(target) && Number(target) > 0
    ? `https://dev.azure.com/${enc(item.org)}/${enc(item.project)}/_workitems/edit/${target}` : null;
  const pr = item.repo;
  const prUrl = item.ado?.prId && text(pr?.org) && text(pr?.project) && text(pr?.name)
    ? `https://dev.azure.com/${enc(pr.org)}/${enc(pr.project)}/_git/${enc(pr.name)}/pullrequest/${enc(item.ado.prId)}` : null;
  let waiting: SessionStatus['waiting'] = null;
  switch (item.stage) {
    case 'tracked': waiting = { reason: 'Waiting for In Progress assignment', targetUrl: workUrl(id) }; break;
    case 'awaiting-parent': waiting = { reason: 'Waiting for a PBI or User Story parent', targetUrl: workUrl(id) }; break;
    case 'awaiting-answers': waiting = { reason: 'Waiting for answers in ADO', targetUrl: workUrl(item.ado?.hldId ?? id) }; break;
    case 'awaiting-approval': waiting = { reason: 'Waiting for HLD or breakdown approval', targetUrl: workUrl(item.ado?.hldId ?? id) }; break;
    case 'pr-open': waiting = { reason: 'Waiting for PR review or checks', targetUrl: prUrl }; break;
    case 'merging': waiting = { reason: 'Waiting for merge completion', targetUrl: prUrl }; break;
    case 'awaiting-pbis': waiting = { reason: 'Waiting for child PBIs', targetUrl: workUrl(id) }; break;
    case 'paused': waiting = { reason: 'Paused or reassigned', targetUrl: workUrl(id) }; break;
    case 'blocked': waiting = { reason: `Blocked: ${item.blocker?.reason ?? item.lastReason ?? 'see work item'}`, targetUrl: workUrl(item.blocker?.workItemId ?? id) }; break;
  }
  let transcriptPath: string | null = null;
  let transcriptExportedAt: string | null = null;
  const path = sessionPath(id, 'transcript.md');
  try {
    const st = statSync(path);
    check(st.isFile(), 'transcript is not a file');
    transcriptPath = path;
    transcriptExportedAt = st.mtime.toISOString();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { schemaVersion: 1, item: identity(id), title: String(item.title), stage: String(item.stage),
    observedAt: new Date().toISOString(), lastSyncedAt, binding, latestRun, waiting, transcriptPath, transcriptExportedAt, liveWatch: readLiveWatch(id),
    liveEventsPath: claim ? runPath(id, claim.runId, 'events.jsonl') : null,
    error: claim && workerNeedsRecovery(claim)
      ? { code: 'ASDF_SESSION_RECOVERY_REQUIRED', message: 'Unfinished worker requires operator investigation; verify all processes stopped before recovery.' }
      : latestRun?.error ?? latestRun?.observationError ?? null };
}

export function refreshSessionStatus(id: number, syncedAt?: string, owner?: string): SessionStatus {
  return withItemGuard(id, () => {
    const claim = readWorkerClaim(id);
    if (claim && claim.owner !== owner) fail('ASDF_LOCK_NOT_OWNER', 'cannot rewrite status for another worker');
    const status = getSessionStatus(id);
    if (!status.binding && !status.liveWatch) return status;
    assertLiveMutation(id, owner);
    if (syncedAt !== undefined) { check(time(syncedAt), 'invalid sync time'); status.lastSyncedAt = syncedAt; }
    const escape = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]<>])/g, '\\$1');
    const lines = [
      `# ${escape(status.title)} (${id})`,
      '', `Stage: ${status.stage}`, `Observed: ${status.observedAt}`, `Last ADO sync: ${status.lastSyncedAt ?? 'not recorded'}`,
      `Session: ${status.binding?.sessionId ?? 'interactive conversation'}`, `Name: ${escape(status.binding?.name ?? status.title)}`,
      `Live watch: ${status.liveWatch?.status ?? 'none'}`, `Live priority expires: ${status.liveWatch?.expiresAt ?? '-'}`,
      `Latest run: ${status.latestRun?.state ?? 'not started'}`,
      `Run started: ${status.latestRun?.startedAt ?? '-'}`, `Run ended: ${status.latestRun?.endedAt ?? '-'}`,
      `Waiting: ${escape(status.waiting?.reason ?? 'not waiting')}`,
      `ADO target: ${status.waiting?.targetUrl ?? '-'}`,
      `Error: ${escape(status.error ? `${status.error.code}: ${status.error.message}` : 'none')}`,
      '', `Last completed transcript: ${status.transcriptPath ?? 'not exported'}`,
      `Transcript exported: ${status.transcriptExportedAt ?? '-'}`,
      `Current-run events: ${status.liveEventsPath ?? 'no active run'}`,
      '', 'Read these files to inspect progress without attaching another CLI to the active conversation.',
      'The transcript is the last completed export; it may be older than the current status.',
    ];
    atomicJson(sessionPath(id, 'status.json'), status);
    atomicText(sessionPath(id, 'status.md'), lines.join('\n') + '\n');
    return status;
  });
}

export function promoteTranscript(id: number, runId: string): void {
  const pending = runPath(id, runId, 'transcript.pending.md');
  if (!statSync(pending).isFile()) fail('ASDF_SESSION_EXPORT_FAILED', 'CLI export is not a file');
  renameSync(pending, sessionPath(id, 'transcript.md'));
}
