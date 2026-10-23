// The ASDF CLI: node scripts/asdf.ts <command> [-Name value ...]. Parameter names are case-insensitive.
// Success prints JSON and exits 0. Failure prints {"error":"<CODE>","message":"..."} and exits 1.
import { readFileSync } from 'node:fs';
import { codePath, executionContext } from './execution.ts';
import { getItem, getItems, itemPath, newItem, setItem, setItemRepo, setItemStage } from './items.ts';
import { heartbeat, lockItem, unlockItem } from './lock.ts';
import { getQueue, getQueueReport } from './queue.ts';
import { completeWorker, failWorker, recoverSession, validateRequest, validateWorkerRequest } from './sessions.ts';
import { getSessionStatus, refreshSessionStatus } from './sessionStatus.ts';
import { readWorkerClaim, withItemGuard } from './workerLease.ts';
import { findRepoSkills } from './repoSkills.ts';
import { ledgerAdd, reviewPackage, taskBrief, taskDone, taskStart } from './sdd.ts';
import { getConfig, getSettings, memoryPath, setConfig, setSettings, settingsPath, withSettingsGuard } from './settings.ts';
import { invokeSignals } from './signals.ts';
import { AsdfError, fail, type Json } from './util.ts';
import { assignmentQuery, discoveryQuery, discoverySources, nextIdPage } from './discovery.ts';
import { recordAutomationEvent } from './automationLog.ts';
import { reserveWorktreePath } from './worktreePaths.ts';
import { assertLiveMutation, readLiveWatch } from './liveWatch.ts';
import { beginLiveInteraction, bindLiveSchedule, checkDesignRequest, consumeDesignFeedback, enterLiveCheck,
  finishLiveCheck, observeDesignDriver, prepareLiveWait, publishDesignRequest, readDesignFeedback,
  recordDesignFeedback, recordLiveInteraction, selectLiveChild, stopLiveWatch, suspendLiveWatch } from './liveContinuation.ts';

type Params = Record<string, Json>;

interface Command {
  required?: string[];
  optional?: string[];
  // Parameters that take a whole number.
  numbers?: string[];
  // The parameter that the JSON document named by -File becomes.
  file?: string;
  run: (p: Params) => unknown;
  exitCode?: (result: Json) => number;
}

const withPath = (item: Json): Json => ({ ...item, path: itemPath(item.id) });

export const COMMANDS: Record<string, Command> = {
  'settings': {
    run: () => {
      const settings = getSettings();
      return { settingsPath: settingsPath(), initialized: Boolean(settings), contextPath: settings ? settings.contextPath : null };
    },
  },
  'settings-set': { required: ['ContextPath'], run: (p) => setSettings(p.ContextPath) },
  'live-info': { required: ['Id'], numbers: ['Id'], run: (p) => readLiveWatch(p.Id) },
  'live-prepare': { required: ['Id', 'Owner', 'ThreadId', 'RootId'], numbers: ['Id', 'RootId'],
    run: (p) => prepareLiveWait(p.Id, p.Owner, p.ThreadId, p.RootId) },
  'live-bind': { required: ['Id', 'Owner', 'WatchId', 'Generation', 'ScheduleId'], numbers: ['Id', 'Generation', 'ScheduleId'],
    run: (p) => bindLiveSchedule(p.Id, p.Owner, { watchId: p.WatchId, generation: p.Generation }, p.ScheduleId) },
  'live-enter': { required: ['Id', 'Owner', 'WatchId', 'Generation'], numbers: ['Id', 'Generation'],
    run: (p) => enterLiveCheck(p.Id, { watchId: p.WatchId, generation: p.Generation }, p.Owner) },
  'live-finish': { required: ['Id', 'Owner', 'WatchId', 'Generation', 'ReadsSucceeded'], numbers: ['Id', 'Generation'],
    run: (p) => {
      if (!['true', 'false'].includes(p.ReadsSucceeded)) fail('ASDF_BAD_ARGUMENT', 'ReadsSucceeded must be true or false');
      return finishLiveCheck(p.Id, { watchId: p.WatchId, generation: p.Generation }, p.Owner, p.ReadsSucceeded === 'true');
    } },
  'live-suspend': { required: ['Id', 'Owner', 'WatchId', 'Generation'], numbers: ['Id', 'Generation'],
    run: (p) => suspendLiveWatch(p.Id, { watchId: p.WatchId, generation: p.Generation }, p.Owner) },
  'live-stop': { required: ['Id', 'Owner', 'WatchId', 'Generation'], numbers: ['Id', 'Generation'],
    run: (p) => stopLiveWatch(p.Id, { watchId: p.WatchId, generation: p.Generation }, p.Owner) },
  'live-interaction': { required: ['Id', 'Owner', 'WatchId', 'Generation', 'File'], numbers: ['Id', 'Generation'], file: 'Interaction',
    run: (p) => beginLiveInteraction(p.Id, { watchId: p.WatchId, generation: p.Generation }, p.Owner, p.Interaction) },
  'live-recorded': { required: ['Id', 'Owner', 'WatchId', 'Generation', 'InteractionId', 'CommentId'], numbers: ['Id', 'Generation', 'CommentId'],
    run: (p) => recordLiveInteraction(p.Id, { watchId: p.WatchId, generation: p.Generation }, p.Owner, p.InteractionId, p.CommentId) },
  'design-request': { required: ['Id', 'Owner', 'File', 'Version', 'RequestedAt'], numbers: ['Id', 'Version'], file: 'Expected',
    run: (p) => publishDesignRequest(p.Id, p.Owner, p.Expected, p.Version, p.RequestedAt) },
  'design-request-check': { required: ['Id', 'Owner', 'File', 'Version', 'RequestedAt'], numbers: ['Id', 'Version'], file: 'Expected',
    run: (p) => checkDesignRequest(p.Id, p.Owner, p.Expected, p.Version, p.RequestedAt) },
  'design-feedback-info': { required: ['Id', 'Owner'], numbers: ['Id'], run: (p) => readDesignFeedback(p.Id, p.Owner) },
  'design-feedback-recorded': { required: ['Id', 'Owner', 'InteractionId', 'CommentId'], numbers: ['Id', 'CommentId'],
    run: (p) => recordDesignFeedback(p.Id, p.Owner, p.InteractionId, p.CommentId) },
  'design-feedback-consume': { required: ['Id', 'Owner', 'FeedbackId', 'Summary'], numbers: ['Id'],
    run: (p) => consumeDesignFeedback(p.Id, p.Owner, p.FeedbackId, p.Summary) },
  'design-role': { required: ['Id', 'Owner', 'Mode'], numbers: ['Id'],
    run: (p) => observeDesignDriver(p.Id, p.Owner, p.Mode) },
  'live-child': { required: ['Id', 'File'], optional: ['Visited'], numbers: ['Id'], file: 'Children',
    run: (p) => selectLiveChild(p.Id, p.Children, p.Visited ? String(p.Visited).split(',').map(Number) : []) },
  'config': { run: () => getConfig() },
  'config-set': { required: ['File'], file: 'Config', run: (p) => setConfig(p.Config) },
  'automation-log': {
    required: ['PassId', 'Action'],
    optional: ['Id', 'Org', 'Project', 'Team', 'Stage', 'From', 'To', 'Outcome', 'Reason', 'ErrorCode'],
    numbers: ['Id'],
    run: (p) => recordAutomationEvent({ passId: p.PassId, action: p.Action, itemId: p.Id,
      org: p.Org, project: p.Project, team: p.Team, stage: p.Stage, from: p.From, to: p.To,
      outcome: p.Outcome, reason: p.Reason, errorCode: p.ErrorCode }),
    exitCode: (result) => result.written ? 0 : 1,
  },
  'discovery-sources': { run: () => discoverySources() },
  'discovery-query': { required: ['Index', 'File'], optional: ['AfterId'], numbers: ['Index', 'AfterId'], file: 'Filters',
    run: (p) => discoveryQuery(p.Index, p.Filters, p.AfterId) },
  'assignment-query': { required: ['Org', 'Project', 'File'], optional: ['AfterId'], numbers: ['AfterId'], file: 'Ids',
    run: (p) => assignmentQuery(p.Org, p.Project, p.Ids, p.AfterId) },
  'query-page': { required: ['File', 'AfterId', 'PageSize'], numbers: ['AfterId', 'PageSize'], file: 'Ids',
    run: (p) => nextIdPage(p.Ids, p.AfterId, p.PageSize) },
  'item-new': {
    required: ['Org', 'Project', 'Id', 'Kind', 'Type', 'Title'], optional: ['ParentId', 'Now'], numbers: ['Id', 'ParentId'],
    run: (p) => newItem({ org: p.Org, project: p.Project, id: p.Id, kind: p.Kind, type: p.Type, title: p.Title, parentId: p.ParentId, now: p.Now }),
  },
  'item': { required: ['Id'], numbers: ['Id'], run: (p) => withPath(getItem(p.Id)) },
  'items': { optional: ['Stage'], run: (p) => getItems(p.Stage ? String(p.Stage).split(',').map((s) => s.trim()).filter(Boolean) : []).map(withPath) },
  'item-set': { required: ['Id', 'File'], optional: ['Owner'], numbers: ['Id'], file: 'Patch', run: (p) => setItem(p.Id, p.Patch) },
  'item-repo': {
    required: ['Id', 'Name'], optional: ['Org', 'Project', 'Owner'], numbers: ['Id'],
    run: (p) => setItemRepo(p.Id, p.Name, p.Org, p.Project),
  },
  'memory-path': { required: ['Org', 'Project', 'Repo'], run: (p) => ({ path: memoryPath(p.Org, p.Project, p.Repo) }) },
  'worktree-path': { required: ['Id', 'Owner'], numbers: ['Id'], run: (p) => reserveWorktreePath(p.Id, p.Owner) },
  'execution-context': { required: ['Id', 'Owner'], numbers: ['Id'], run: (p) => executionContext(p.Id, p.Owner) },
  'code-path': { required: ['Id', 'Owner', 'Path'], numbers: ['Id'], run: (p) => codePath(p.Id, p.Owner, p.Path) },
  'stage': {
    required: ['Id', 'Stage'], optional: ['Reason', 'WorkItemId', 'Now', 'Owner'], numbers: ['Id', 'WorkItemId'],
    run: (p) => setItemStage(p.Id, p.Stage, p.Reason, p.WorkItemId, p.Now),
  },
  'signals': {
    required: ['Id', 'File'], optional: ['Now', 'Owner'], numbers: ['Id'], file: 'Signals',
    run: (p) => invokeSignals(p.Id, p.Signals, p.Now, p.Owner),
  },
  'queue': { optional: ['Now'], run: (p) => getQueue(p.Now) },
  'queue-report': { optional: ['Now'], run: (p) => getQueueReport(p.Now) },
  'session-info': { required: ['Id'], numbers: ['Id'], run: (p) => getSessionStatus(p.Id) },
  'worker-request': { required: ['Id', 'RunId', 'Owner'], numbers: ['Id'], run: (p) => validateWorkerRequest(p.Id, p.RunId, p.Owner) },
  'worker-complete': { required: ['Id', 'RunId', 'Owner', 'File'], numbers: ['Id'], file: 'Result', run: (p) => completeWorker(p.Id, p.RunId, p.Owner, p.Result) },
  'worker-fail': { required: ['Id', 'RunId', 'Owner', 'File'], numbers: ['Id'], file: 'Result', run: (p) => failWorker(p.Id, p.RunId, p.Owner, p.Result) },
  'session-recover': {
    required: ['Id', 'RunId', 'Action', 'Reason'], optional: ['ProcessesStopped'], numbers: ['Id'],
    run: (p) => {
      if (p.ProcessesStopped !== undefined && !['true', 'false'].includes(p.ProcessesStopped)) fail('ASDF_BAD_ARGUMENT', '-ProcessesStopped must be true or false');
      return recoverSession(p.Id, p.RunId, p.Action, p.Reason, p.ProcessesStopped === 'true');
    },
  },
  'lock': { required: ['Id', 'Owner'], optional: ['Now'], numbers: ['Id'], run: (p) => lockItem(p.Id, p.Owner, p.Now) },
  'heartbeat': { required: ['Id', 'Owner'], optional: ['Now'], numbers: ['Id'], run: (p) => heartbeat(p.Id, p.Owner, p.Now) },
  'unlock': { required: ['Id', 'Owner'], numbers: ['Id'], run: (p) => unlockItem(p.Id, p.Owner) },
  'repo-skills': { required: ['RepoPath', 'Kind'], run: (p) => findRepoSkills(p.RepoPath, p.Kind) },
  'task-brief': {
    required: ['Id', 'PlanPath', 'TaskNumber'], optional: ['Owner'], numbers: ['Id', 'TaskNumber'],
    run: (p) => ({ path: taskBrief(p.Id, p.PlanPath, p.TaskNumber) }),
  },
  'review-package': {
    required: ['Id', 'RepoPath', 'Base', 'Head', 'Owner'], numbers: ['Id'],
    run: (p) => ({ path: reviewPackage(p.Id, p.RepoPath, p.Base, p.Head, p.Owner) }),
  },
  'ledger-add': { required: ['Id', 'Text'], optional: ['Now', 'Owner'], numbers: ['Id'], run: (p) => ({ line: ledgerAdd(p.Id, p.Text, p.Now) }) },
  'task-start': {
    required: ['Id', 'PlanPath', 'TaskNumber', 'RepoPath', 'Owner'], numbers: ['Id', 'TaskNumber'],
    run: (p) => taskStart(p.Id, p.PlanPath, p.TaskNumber, p.RepoPath, p.Owner),
  },
  'task-done': {
    required: ['Id', 'TaskNumber', 'Base', 'RepoPath', 'TestCommand', 'Owner'], numbers: ['Id', 'TaskNumber'],
    run: (p) => taskDone(p.Id, p.TaskNumber, p.Base, p.RepoPath, p.TestCommand, p.Owner),
    exitCode: (result) => result.exitCode,
  },
};

function readJsonFile(path: string): Json {
  let text: string;
  try {
    text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    fail('ASDF_BAD_ARGUMENT', `cannot read -File ${path}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail('ASDF_BAD_ARGUMENT', `-File ${path} is not valid JSON`);
  }
}

// The command's parameters from "-Name value" pairs, with names in the command's own spelling.
export function parseArgs(name: string, command: Command, tokens: string[]): Params {
  const known = [...(command.required ?? []), ...(command.optional ?? [])];
  const params: Params = {};
  for (let i = 0; i < tokens.length; i += 2) {
    const flag = /^-([A-Za-z]\w*)$/.exec(tokens[i]);
    if (!flag) fail('ASDF_BAD_ARGUMENT', `expected -Name value, got '${tokens[i]}'`);
    if (i + 1 >= tokens.length) fail('ASDF_MISSING_ARGUMENT', `no value for -${flag[1]}`);
    const param = known.find((k) => k.toLowerCase() === flag[1].toLowerCase());
    if (!param) fail('ASDF_BAD_ARGUMENT', flag[1].toLowerCase() === 'file' ? `${name} does not take -File` : `${name} has no parameter -${flag[1]}`);
    params[param] = tokens[i + 1];
  }
  for (const param of command.required ?? []) {
    if (!(param in params)) fail('ASDF_MISSING_ARGUMENT', `-${param}`);
  }
  for (const param of command.numbers ?? []) {
    if (!(param in params)) continue;
    if (!/^\s*-?\d+\s*$/.test(params[param])) fail('ASDF_BAD_ARGUMENT', `-${param} must be a whole number, not '${params[param]}'`);
    params[param] = Number(params[param]);
  }
  if (command.file) params[command.file] = readJsonFile(params.File);
  return params;
}

export function runCli(argv: string[]): { exitCode: number; output: string } {
  try {
    const [name, ...tokens] = argv;
    if (!name) fail('ASDF_MISSING_ARGUMENT', `a command: ${Object.keys(COMMANDS).join(', ')}`);
    if (!Object.hasOwn(COMMANDS, name)) fail('ASDF_UNKNOWN_COMMAND', name);
    const command = COMMANDS[name];
    const params = parseArgs(name, command, tokens);
    let workerOwner: string | undefined;
    if (process.env.ASDF_WORKER_REQUEST) {
      const raw = readJsonFile(process.env.ASDF_WORKER_REQUEST);
      const request = validateRequest(raw?.item?.id, raw);
      validateWorkerRequest(request.item.id, request.runId, request.owner);
      if (name === 'automation-log' && params.PassId !== request.passId) fail('ASDF_BAD_ARGUMENT', 'automation-log must use the current worker request.passId, not its owner or session ID');
      workerOwner = request.owner;
    }
    const mutates = ['stage', 'item-set', 'item-repo', 'signals', 'ledger-add', 'task-brief'].includes(name);
    let operationApplied = false;
    const invoke = () => {
      if (mutates && name !== 'signals') {
        assertLiveMutation(params.Id, workerOwner ?? params.Owner);
        const claim = readWorkerClaim(params.Id);
        if (claim && claim.owner !== workerOwner) fail('ASDF_LOCK_NOT_OWNER', 'item has an active worker');
      }
      if (name === 'signals' && params.Owner !== undefined) assertLiveMutation(params.Id, params.Owner);
      const value = command.run(params);
      if (['stage', 'item-set', 'item-repo', 'signals'].includes(name) && !(name === 'signals' && (value as Json).processed === false)) {
        operationApplied = true;
        refreshSessionStatus(params.Id, name === 'signals' ? new Date(params.Now ?? Date.now()).toISOString() : undefined, workerOwner ?? params.Owner);
      }
      return value;
    };
    let result: unknown;
    try { result = mutates ? withSettingsGuard(() => withItemGuard(params.Id, invoke)) : invoke(); }
    catch (error) {
      if (!operationApplied) throw error;
      return { exitCode: 1, output: JSON.stringify({ error: 'ASDF_SESSION_STATUS_FAILED',
        message: error instanceof Error ? error.message : String(error), operationApplied: true }) };
    }
    return { exitCode: command.exitCode?.(result) ?? 0, output: JSON.stringify(result ?? null) };
  } catch (error) {
    const code = error instanceof AsdfError ? error.code : 'ASDF_INTERNAL';
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, output: JSON.stringify({ error: code, message }) };
  }
}
