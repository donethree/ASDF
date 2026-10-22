import { withItemGuard } from '../../scripts/lib/workerLease.ts';
withItemGuard(42, () => {
  process.stdout.write('holding\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[2] ?? 60_000));
});
