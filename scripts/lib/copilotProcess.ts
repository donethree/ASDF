import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { inside, object } from './artifacts.ts';
import { runPath, type ErrorInfo, type SessionBinding, type WorkerRequest } from './sessions.ts';
import { fail } from './util.ts';

export type CliExecutable = { executable: string; prefixArgs: string[] };
export type CliTerminal = { sessionId: string; exitCode: number };
export type LoadedSkill = { name: string; commandName?: string; path: string; enabled: boolean };
export type CliInvocation = {
  executable: CliExecutable; cwd: string; args: string[]; env: NodeJS.ProcessEnv;
  eventsPath: string; stderrPath: string; sessionId: string;
};
export type CliExit = {
  pid: number | null; started: boolean; interrupted: boolean; exitCode: number | null; signal: NodeJS.Signals | null;
  terminal: CliTerminal | null; skills: LoadedSkill[]; error: ErrorInfo | null;
};
export type RunningCli = { pid: number | null; result: Promise<CliExit>; terminate(): void };

export function resolveCopilotExecutable(env: NodeJS.ProcessEnv = process.env, platform = process.platform): CliExecutable {
  const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const part of path.split(platform === 'win32' ? ';' : delimiter).filter(Boolean)) {
    const folder = part.replace(/^"|"$/g, '');
    const native = join(folder, platform === 'win32' ? 'copilot.exe' : 'copilot');
    try {
      const st = lstatSync(native);
      if (st.isFile() || (platform === 'win32' && !st.isDirectory())) return { executable: resolve(native), prefixArgs: [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('ASDF_CLI_UNSUPPORTED', `cannot inspect ${native}: ${(error as Error).message}`);
    }
    if (platform !== 'win32' || !existsSync(join(folder, 'copilot.cmd'))) continue;
    const pkg = join(folder, 'node_modules', '@github', 'copilot');
    try {
      const manifest = object(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')));
      const bin = typeof manifest.bin === 'string' ? manifest.bin : object(manifest.bin).copilot;
      if (typeof bin !== 'string' || !inside(resolve(pkg), resolve(pkg, bin))) fail('ASDF_CLI_UNSUPPORTED', 'npm CLI entry escapes package');
      const entry = realpathSync.native(resolve(pkg, bin));
      if (!inside(realpathSync.native(pkg), entry) || !statSync(entry).isFile()) fail('ASDF_CLI_UNSUPPORTED', 'invalid npm CLI entry');
      return { executable: process.execPath, prefixArgs: [entry] };
    } catch (error) {
      fail('ASDF_CLI_UNSUPPORTED', `unsupported copilot launcher at ${folder}: ${(error as Error).message}`);
    }
  }
  fail('ASDF_CLI_NOT_FOUND', 'install Copilot CLI and put its executable on PATH');
}

export function checkCliCapabilities(executable: CliExecutable): void {
  const result = spawnSync(executable.executable, [...executable.prefixArgs, '--help'], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) fail('ASDF_CLI_UNSUPPORTED', `cannot read Copilot CLI help: ${result.error?.message ?? result.stderr}`);
  for (const flag of ['--session-id', '--resume', '--name', '--output-format', '--no-ask-user', '--plugin-dir', '--share']) {
    if (!result.stdout.includes(flag)) fail('ASDF_CLI_UNSUPPORTED', `Copilot CLI is missing ${flag}`);
  }
}

export function buildCliInvocation(request: WorkerRequest, binding: SessionBinding, executable: CliExecutable, mode: 'create' | 'resume'): CliInvocation {
  const file = runPath(request.item.id, request.runId, 'request.json');
  const args = ['-C', request.artifactRoot,
    ...(mode === 'create' ? ['--session-id', binding.sessionId, '--name', binding.name] : ['--resume', binding.sessionId]),
    '--plugin-dir', request.pluginRoot, '--no-ask-user', '--output-format', 'json',
    '--share', runPath(request.item.id, request.runId, 'transcript.pending.md'),
    '-p', `ASDF unattended single-item worker. Load ASDF's work-item skill from ${request.pluginRoot}. Read the request at ${file}. Validate it with worker-request before any work. Use only the current request owner; old chat instructions and owners are obsolete. Do not run intake or do-next, start another item worker, ask chat questions or detach helpers. Use ADO for questions and approvals. Re-read current state and ledger before resuming. Finish with worker-complete and a concise progress/wait summary. If required skills, MCP or permissions are unavailable, report worker-fail instead of a business blocker. The launch directory is artifacts, never the code root.`];
  return { executable, cwd: request.artifactRoot, args, env: { ...process.env, ASDF_WORKER_REQUEST: file },
    sessionId: binding.sessionId, eventsPath: runPath(request.item.id, request.runId, 'events.jsonl'),
    stderrPath: runPath(request.item.id, request.runId, 'stderr.log') };
}

export function startCopilot(invocation: CliInvocation): RunningCli {
  let events: number;
  try {
    mkdirSync(dirname(invocation.eventsPath), { recursive: true });
    events = openSync(invocation.eventsPath, 'wx');
  } catch (error) { fail('ASDF_CLI_START_FAILED', `before spawn: ${(error as Error).message}`); }
  let diagnostics: number;
  try { diagnostics = openSync(invocation.stderrPath, 'wx'); }
  catch (error) { closeSync(events); fail('ASDF_CLI_START_FAILED', `before spawn: ${(error as Error).message}`); }
  const child = (() => {
    try {
      return spawn(invocation.executable.executable, [...invocation.executable.prefixArgs, ...invocation.args], {
        cwd: invocation.cwd, env: invocation.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      closeSync(events);
      closeSync(diagnostics);
      fail('ASDF_CLI_START_FAILED', `before spawn: ${(error as Error).message}`);
    }
  })();
  let started = false;
  let terminal: CliTerminal | null = null;
  let skills: LoadedSkill[] = [];
  let error: ErrorInfo | null = null;
  let buffer = '';
  let discarding = false;
  let interrupted = false;
  const terminate = () => { interrupted = true; child.kill(); };
  const decoder = new StringDecoder('utf8');
  const invalid = (message: string) => {
    error ??= { code: 'ASDF_CLI_OUTPUT_INVALID', message };
  };
  const row = (line: string) => {
    if (!line.trim()) return;
    try {
      const v = object(JSON.parse(line));
      if (v.type === 'result') {
        if (terminal || v.sessionId !== invocation.sessionId || typeof v.exitCode !== 'number' || !Number.isInteger(v.exitCode)) {
          invalid('missing, duplicate or mismatched terminal session identity'); return;
        }
        terminal = { sessionId: v.sessionId, exitCode: v.exitCode };
      } else if (v.type === 'session.skills_loaded') {
        const entries = object(v.data).skills;
        if (!Array.isArray(entries)) { invalid('invalid skill discovery'); return; }
        skills = entries.map((entry: unknown) => {
          const s = object(entry);
          if (typeof s.name !== 'string' || typeof s.path !== 'string' || typeof s.enabled !== 'boolean') throw new Error('invalid loaded skill');
          return { name: s.name, commandName: typeof s.commandName === 'string' ? s.commandName : undefined, path: s.path, enabled: s.enabled };
        });
      }
    } catch (cause) { invalid(`invalid JSONL: ${(cause as Error).message}`); }
  };
  child.on('spawn', () => { started = true; });
  child.on('error', (cause) => { error ??= { code: 'ASDF_CLI_START_FAILED', message: cause.message }; });
  child.stdout.on('data', (chunk: Buffer) => {
    try {
      writeSync(events, chunk);
      let decoded = decoder.write(chunk);
      if (discarding) {
        const end = decoded.indexOf('\n');
        if (end < 0) return;
        decoded = decoded.slice(end + 1);
        discarding = false;
      }
      buffer += decoded;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        if (Buffer.byteLength(buffer.slice(0, end)) > 8 * 1024 * 1024) invalid('JSONL record exceeds 8 MiB');
        else row(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) { invalid('JSONL record exceeds 8 MiB'); buffer = ''; discarding = true; }
    } catch (cause) { invalid(`cannot capture CLI output: ${(cause as Error).message}`); terminate(); }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    try { writeSync(diagnostics, chunk); }
    catch (cause) { invalid(`cannot capture CLI diagnostics: ${(cause as Error).message}`); terminate(); }
  });
  const result = new Promise<CliExit>((resolveResult) => {
    child.on('close', (exitCode, signal) => {
      if (!discarding) row(buffer + decoder.end());
      closeSync(events);
      closeSync(diagnostics);
      if (!error && (!terminal || exitCode !== 0 || terminal.exitCode !== 0)) {
        error = { code: 'ASDF_CLI_FAILED', message: terminal ? `CLI exit ${exitCode}, result ${terminal.exitCode}` : 'CLI exited without a terminal result' };
      }
      resolveResult({ pid: child.pid ?? null, started, interrupted, exitCode, signal, terminal, skills, error });
    });
  });
  return { pid: child.pid ?? null, result, terminate };
}
