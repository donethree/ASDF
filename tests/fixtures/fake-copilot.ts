import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { listRuns, runPath } from '../../scripts/lib/sessions.ts';
const args = process.argv.slice(2);
const value = (name: string) => args[args.indexOf(name) + 1];
if (args.includes('--help')) {
  if (value('--scenario') === 'fail-capture') {
    const run = listRuns(42)[0];
    mkdirSync(runPath(42, run.request.runId, 'events.jsonl'));
  }
  console.log('--session-id --resume --name --output-format --no-ask-user --plugin-dir --share -C -p');
  process.exit(0);
}
const mode = value('--scenario');
const request = JSON.parse(readFileSync(process.env.ASDF_WORKER_REQUEST!, 'utf8'));
const emit = (event: unknown) => process.stdout.write(JSON.stringify(event) + '\n');
if (mode === 'hold') await setTimeout(300);
if (mode === 'invalid') { console.log('not JSON'); process.exit(1); }
if (mode === 'oversize') { console.log('x'.repeat(8 * 1024 * 1024 + 1)); process.exit(1); }
if (mode === 'no-terminal') { emit({ type: 'assistant.message', data: { content: 'success' } }); process.exit(0); }
if (mode === 'chunked') {
  const row = JSON.stringify({ type: 'unknown', data: 'split' }) + '\n';
  process.stdout.write(row.slice(0, 10));
  await setTimeout(10);
  process.stdout.write(row.slice(10));
}
if (mode === 'notice') { console.log('Notice: diagnostic stdout'); await setTimeout(100); }
if (mode.startsWith('worker')) {
  if (mode === 'worker-hold') await setTimeout(300);
  if (mode === 'worker-wait') await setTimeout(6500);
  const cli = (...args: string[]) => {
    const result = spawnSync(request.cli.executable, [request.cli.script, ...args], { env: process.env, encoding: 'utf8' });
    if (result.status !== 0) { process.stderr.write(result.stdout + result.stderr); process.exit(2); }
    return JSON.parse(result.stdout);
  };
  cli('worker-request', '-Id', '42', '-RunId', request.runId, '-Owner', request.owner);
  const stage = request.expectedStage === 'new' ? 'awaiting-answers' : 'awaiting-approval';
  if (mode !== 'worker-infra') cli('stage', '-Id', '42', '-Stage', stage);
  const resultFile = process.env.ASDF_WORKER_REQUEST!.replace('request.json', 'fixture-result.json');
  if (mode === 'worker-infra') {
    writeFileSync(resultFile, JSON.stringify({ code: 'ASDF_WORKER_MCP_UNAVAILABLE', message: 'sign in required' }));
    cli('worker-fail', '-Id', '42', '-RunId', request.runId, '-Owner', request.owner, '-File', resultFile);
  } else if (mode !== 'worker-incomplete') {
    writeFileSync(resultFile, JSON.stringify({ sessionId: request.sessionId, outcome: 'waiting', summary: 'Waiting for the next answer' }));
    cli('worker-complete', '-Id', '42', '-RunId', request.runId, '-Owner', request.owner, '-File', resultFile);
  }
}
if (mode !== 'worker-no-export') writeFileSync(value('--share'), JSON.stringify({ args, cwd: process.cwd() }));
emit({ type: 'session.skills_loaded', data: { skills: [
  { name: 'work-item', commandName: 'asdf:work-item', path: request.pluginRoot + '/skills/work-item/SKILL.md', enabled: true },
] } });
emit({ type: 'unknown', data: { future: true } });
emit({ type: 'result', sessionId: mode === 'wrong-id' ? '00000000-0000-4000-8000-000000000000' : request.sessionId,
  exitCode: mode === 'nonzero' ? 1 : 0 });
process.exitCode = mode === 'nonzero' ? 1 : 0;
