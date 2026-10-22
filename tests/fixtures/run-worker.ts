import { runWorker } from '../../scripts/lib/worker.ts';
import { fileURLToPath } from 'node:url';
const result = await runWorker({ id: 42, passId: process.argv[2] }, {
  executable: process.execPath, prefixArgs: [fileURLToPath(new URL('./fake-copilot.ts', import.meta.url)), '--scenario', 'worker-hold'],
});
console.log(JSON.stringify(result));
