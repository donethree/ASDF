import { parseArgs } from './lib/cli.ts';
import { runWorker } from './lib/worker.ts';
import { AsdfError } from './lib/util.ts';

try {
  const args = parseArgs('worker', { required: ['Id', 'PassId'], numbers: ['Id'], run: () => null }, process.argv.slice(2));
  const result = await runWorker({ id: args.Id, passId: args.PassId });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = ['completed', 'deferred'].includes(result.status) ? 0 : 1;
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof AsdfError ? error.code : 'ASDF_WORKER_FAILED',
    message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
