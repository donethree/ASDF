#!/usr/bin/env node
const args = process.argv.slice(2);
try {
  if (!args.length || (args.length === 1 && args[0] === '--help')) {
    console.log('ASDF\n  node asdf.js --init     Guided local setup (run manually)\n  node asdf.js <command>  Existing JSON CLI commands\nRequires Node.js 22.18 or later. Setup never contacts ADO or signs in.');
  } else if (args.includes('--init')) {
    if (args.length !== 1) throw new Error('--init cannot be combined with other arguments');
    const { runSetup } = await import('./scripts/lib/setup.ts');
    const { createTerminalIO } = await import('./scripts/lib/setupPrompt.ts');
    const result = await runSetup(createTerminalIO(process.stdin, process.stdout));
    process.exitCode = result.status === 'saved' ? 0 : 130;
  } else {
    const { runCli } = await import('./scripts/lib/cli.ts');
    const result = runCli(args);
    console.log(result.output);
    process.exitCode = result.exitCode;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
