// SDD workspace helpers: the item folder's sdd/ holds task briefs, review packages, test logs and the ledger.
// Ports of Superpowers' sdd-workspace, task-brief, review-package, task-start and task-done.
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { artifactPath, executionContext, requireBaseline, shellWorkingDirectory } from './execution.ts';
import { fail, git, now, readLines, stamp, writeJson, type Json } from './util.ts';

function resolveRef(repoPath: string, ref: string): string {
  const result = git(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const sha = result.out.trim().split(/\r?\n/)[0]?.trim();
  if (result.code !== 0 || !sha) fail('ASDF_BAD_REF', ref);
  return sha;
}

export function sddPath(id: number): string {
  const path = artifactPath(id, 'sdd');
  mkdirSync(path, { recursive: true });
  return path;
}

// A task runs from its "Task N" heading to the next Task heading, the next "## " heading, or the end.
// Headings inside ``` fences don't count, so templates in code blocks never cut a brief short.
export function taskBrief(id: number, planPath: string, taskNumber: number): string {
  planPath = artifactPath(id, planPath);
  const thisTask = new RegExp(`^#+\\s+Task\\s+${taskNumber}(\\D|$)`, 'i');
  const brief: string[] = [];
  let inFence = false;
  let inTask = false;
  for (const line of readLines(planPath)) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    else if (!inFence) {
      if (/^#+\s+Task\s+\d+/i.test(line)) inTask = thisTask.test(line);
      else if (inTask && line.startsWith('## ')) inTask = false;
    }
    if (inTask) brief.push(line);
  }
  if (brief.length === 0) fail('ASDF_TASK_NOT_FOUND', `task ${taskNumber} in ${planPath}`);
  sddPath(id);
  const out = artifactPath(id, 'sdd', `task-${taskNumber}-brief.md`);
  writeFileSync(out, brief.join('\n') + '\n', 'utf8');
  return out;
}

// The commits, file stats and diff (10 lines of context) between two refs, for a reviewer.
export function reviewPackage(id: number, repoPath: string, base: string, head: string, owner: string): string {
  repoPath = executionContext(id, owner, repoPath).codeRoot;
  const b = resolveRef(repoPath, base);
  const h = resolveRef(repoPath, head);
  const range = `${b}..${h}`;
  const checked = (args: string[]) => {
    const result = git(repoPath, args);
    if (result.code !== 0) fail('ASDF_GIT_FAILED', `git ${args[0]} failed: ${result.error.trim()}`);
    return result.out;
  };
  const sections = [
    checked(['log', '--no-color', '--oneline', range]),
    checked(['diff', '--no-color', '--stat', range]),
    checked(['diff', '--no-color', '-U10', range]),
  ];
  sddPath(id);
  const out = artifactPath(id, 'sdd', `review-${b.substring(0, 7)}..${h.substring(0, 7)}.diff`);
  writeFileSync(out, sections.map((s) => s.replace(/\n$/, '')).join('\n\n') + '\n', 'utf8');
  return out;
}

export function ledgerAdd(id: number, text: string, at?: string | Date): string {
  const line = `- ${stamp(now(at))} ${text}`;
  sddPath(id);
  appendFileSync(artifactPath(id, 'sdd', 'ledger.md'), line + '\n', 'utf8');
  return line;
}

export function taskStart(id: number, planPath: string, taskNumber: number, repoPath: string, owner: string): Json {
  const context = executionContext(id, owner, repoPath);
  requireBaseline(context);
  const brief = taskBrief(id, planPath, taskNumber);
  return { brief, base: context.head, context };
}

export function runBaseline(id: number, owner: string, buildCommand: string, testCommand?: string): Json {
  const context = executionContext(id, owner);
  const cwd = shellWorkingDirectory(context.codeRoot);
  if (!buildCommand.trim() || (testCommand !== undefined && !testCommand.trim())) fail('ASDF_BAD_ARGUMENT', 'baseline commands must not be empty');
  const file = artifactPath(id, 'baseline.json');
  const log = artifactPath(id, 'baseline.log');
  const record = { owner, codeRoot: context.codeRoot, branch: context.branch, head: context.head,
    buildCommand, testCommand, log, passed: false, at: stamp(now()) };
  writeJson(file, record);
  const fd = openSync(log, 'w');
  let exitCode = 0;
  try {
    for (const command of [buildCommand, ...(testCommand === undefined ? [] : [testCommand])]) {
      executionContext(id, owner, cwd);
      writeSync(fd, `$ ${command}\n`);
      const result = spawnSync(command, { cwd, shell: true, stdio: ['ignore', fd, fd], windowsHide: true });
      if (result.error) writeSync(fd, `${result.error.message}\n`);
      exitCode = result.error ? 1 : (result.status ?? 1);
      if (exitCode !== 0) break;
    }
  } finally { closeSync(fd); }
  const after = executionContext(id, owner, cwd);
  if (after.head !== context.head) fail('ASDF_EXECUTION_CONTEXT', 'baseline command changed HEAD; review repository initialization before continuing');
  record.passed = exitCode === 0;
  writeJson(file, record);
  return { exitCode, log, recorded: record.passed };
}

// Runs the task's test command through the system shell; only a passing run is written to the ledger.
export function taskDone(id: number, taskNumber: number, base: string, repoPath: string, testCommand: string, owner: string): Json {
  const context = executionContext(id, owner, repoPath);
  requireBaseline(context);
  repoPath = shellWorkingDirectory(context.codeRoot);
  const b = resolveRef(repoPath, base);
  sddPath(id);
  const log = artifactPath(id, 'sdd', `task-${taskNumber}-test.log`);
  const fd = openSync(log, 'w');
  let exitCode: number;
  try {
    const result = spawnSync(testCommand, { cwd: repoPath, shell: true, stdio: ['ignore', fd, fd], windowsHide: true });
    if (result.error) writeSync(fd, `${result.error.message}\n`);
    exitCode = result.error ? 1 : (result.status ?? 1);
  } finally {
    closeSync(fd);
  }
  let recorded = false;
  if (exitCode === 0) {
    executionContext(id, owner, repoPath);
    const h = resolveRef(repoPath, 'HEAD');
    // The line format both asdf:subagent-driven-development and asdf:executing-plans resume from.
    ledgerAdd(id, `Task ${taskNumber}: complete (commits ${b.substring(0, 7)}..${h.substring(0, 7)}, tests: ${testCommand} → pass)`);
    recorded = true;
  }
  return { exitCode, log, recorded };
}
