import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { lockItem } from '../../scripts/lib/lock.ts';
import { withSettingsGuard, settingsPath } from '../../scripts/lib/settings.ts';
import { runCli } from '../../scripts/lib/cli.ts';
const marker = settingsPath() + '.held';
if (process.argv[2] === 'hold') {
  withSettingsGuard(() => {
    writeFileSync(marker, 'held');
    process.stdout.write('holding\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    rmSync(marker);
  });
} else if (process.argv[2] === 'stage') {
  const result = runCli(['stage', '-Id', '42', '-Stage', 'new']);
  console.log(JSON.stringify({ code: result.exitCode, observedHeld: existsSync(marker) }));
} else {
  const result = lockItem(42, 'new-operation');
  console.log(JSON.stringify({ ...result, observedHeld: existsSync(marker) }));
}
