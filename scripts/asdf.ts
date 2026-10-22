// ASDF CLI entry point: node scripts/asdf.ts <command> [-Name value ...]. The commands are in lib/cli.ts.
import { runCli } from './lib/cli.ts';

const { exitCode, output } = runCli(process.argv.slice(2));
process.stdout.write(output + '\n');
process.exitCode = exitCode;
