// Bisection helper: find which test file creates an unwanted file or folder.
// Usage:   node find-polluter.ts <path_to_check> <test_pattern> [test command]
// Example: node find-polluter.ts .git "src/**/*.test.ts" "npx vitest run"
// Each matching test file runs on its own as "<test command> <file>" from the current folder (default: npm test).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Glob as a regex over forward-slash relative paths: '**/' is any depth (including none), '*' stays within one folder.
function globToRegex(glob: string): RegExp {
  const pattern = glob.replace(/^\.\//, '');
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.startsWith('**/', i)) {
      source += '(.*/)?';
      i += 2;
    } else if (pattern.startsWith('**', i)) {
      source += '.*';
      i += 1;
    } else if (pattern[i] === '*') source += '[^/]*';
    else if (pattern[i] === '?') source += '[^/]';
    else source += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

// Every file under the current folder as a forward-slash relative path, skipping hidden folders and node_modules.
function filesUnder(folder: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') files.push(...filesUnder(join(folder, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.isFile()) files.push(`${prefix}${entry.name}`);
  }
  return files;
}

function main(args: string[]): number {
  const [pollutionCheck, testPattern, testCommand = 'npm test'] = args;
  if (!pollutionCheck || !testPattern) {
    console.error('Usage: node find-polluter.ts <path_to_check> <test_pattern> [test command]');
    return 2;
  }
  console.log(`Searching for the test that creates: ${pollutionCheck}`);
  if (existsSync(pollutionCheck)) {
    console.error('Pollution already exists; start from a clean test workspace before searching.');
    return 2;
  }
  console.log(`Test pattern: ${testPattern}`);
  const regex = globToRegex(testPattern);
  const files = [...new Set(filesUnder(process.cwd()).filter((file) => regex.test(file)))].sort();
  console.log(`Found ${files.length} test files`);
  if (files.length === 0) {
    console.error('No tests matched; nothing was checked.');
    return 2;
  }

  for (const [index, file] of files.entries()) {
    const count = `${index + 1}/${files.length}`;
    if (existsSync(pollutionCheck)) {
      console.error(`Pollution appeared before test ${count}; cannot attribute it to ${file}.`);
      return 2;
    }
    console.log(`[${count}] Testing: ${file}`);
    const result = spawnSync(`${testCommand} "${file}"`, { shell: true, stdio: 'inherit', windowsHide: true });
    if (existsSync(pollutionCheck)) {
      console.log(`FOUND POLLUTER: ${file}`);
      console.log(`   Created: ${pollutionCheck}`);
      console.log(`To investigate: ${testCommand} ${file}`);
      return 1;
    }
    if (result.error || result.status !== 0) {
      console.error(`Test command failed for ${file}: ${result.error?.message ?? result.status ?? result.signal}`);
      return 2;
    }
  }
  console.log('No polluter found - all tests clean!');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
