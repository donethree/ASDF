// Guard rules: the "never" actions ASDF blocks outright, since unattended runs have every tool approved.
// Pure on purpose: the preToolUse hook runs on every tool call, so this loads nothing but util.
import { oneOf, prop, same, toList } from './util.ts';

const HTTP_CLIENT = /\b(Invoke-RestMethod|Invoke-WebRequest|irm|iwr|curl(\.exe)?|wget(\.exe)?|WebClient|HttpClient|az(\.cmd)?\s+rest)\b/i;
const ADO_HOST = /(dev\.azure\.com|\.visualstudio\.com)/i;
const ADO_CLI = /\baz(\.cmd)?\s+(devops|boards|repos|pipelines|artifacts)\b/i;
const PROTECTED = ['main', 'master', 'refs/heads/main', 'refs/heads/master'];

// Whitespace-separated tokens, keeping quoted strings together (quotes dropped).
function tokensOf(segment: string): string[] {
  return (segment.match(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g) ?? [])
    .map((token) => token.replace(/"([^"]*)"|'([^']*)'/g, (_, double: string | undefined, single: string | undefined) => double ?? single ?? ''));
}

function isForceFlag(token: string): boolean {
  return oneOf(token, ['--force', '--mirror', '--all']) || /^--force-with-lease/i.test(token) || /^-[A-Za-z]*f[A-Za-z]*$/.test(token);
}

// Why a `git push` in one command segment is denied, or null when it is fine (or isn't a push).
function gitPushReason(segment: string, prefix: string | null): string | null {
  const tokens = tokensOf(segment);
  let i = tokens.findIndex((token) => /^(.*[\\/])?git(\.exe)?$/i.test(token));
  if (i < 0) return null;
  i++;
  // Skip git's global options (-C <path>, -c <name=value>, --git-dir=..., ...).
  const globalValues = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source'];
  const globalFlags = ['--bare', '--no-pager', '--paginate', '-p', '-P', '--no-replace-objects', '--literal-pathspecs',
    '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs', '--no-optional-locks', '--no-lazy-fetch', '--no-advice'];
  while (i < tokens.length && tokens[i].startsWith('-')) {
    const option = tokens[i];
    if (globalValues.includes(option)) i += 2;
    else if (globalFlags.includes(option) || globalValues.some((flag) => option.startsWith(`${flag}=`)) || /^-[Cc].+/.test(option)) i++;
    else {
      return tokens.slice(i).some((token) => same(token, 'push'))
        ? 'ASDF guard: cannot verify the push destination with these git options.'
        : null;
    }
  }
  if (i >= tokens.length || !same(tokens[i], 'push')) return null;
  const positional: string[] = [];
  let explicitRepo = false;
  for (let j = i + 1; j < tokens.length; j++) {
    const token = tokens[j];
    if (isForceFlag(token)) return 'ASDF guard: force-push and mirror/all pushes are never allowed.';
    if (token === '--repo' || token.startsWith('--repo=')) explicitRepo = true;
    if (['--repo', '-o', '--push-option', '--receive-pack', '--exec'].includes(token)) {
      j++;
      continue;
    }
    if (!token.startsWith('-')) positional.push(token);
  }
  // The first positional is the remote; the rest are refspecs.
  const refspecs = explicitRepo ? positional : positional.slice(1);
  for (const refspec of refspecs) {
    if (refspec.startsWith('+')) return 'ASDF guard: force-push is never allowed.';
    const destination = refspec.includes(':') ? refspec.substring(refspec.lastIndexOf(':') + 1) : refspec;
    if (oneOf(destination, PROTECTED)) return 'ASDF guard: pushing to main or master is never allowed.';
    const branch = destination.replace(/^refs\/heads\//i, '');
    if (prefix && !/^refs\/tags\//i.test(destination) && !branch.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) {
      return `ASDF guard: push only to branches under ${prefix}/, for example ${prefix}/<id>-<short title>.`;
    }
  }
  // Without a refspec git picks the branch itself, so the guard can't check it. Tags alone are fine.
  if (prefix && refspecs.length === 0 && !tokens.some((token) => same(token, '--tags'))) {
    return `ASDF guard: name the branch you push; it must be under ${prefix}/.`;
  }
  return null;
}

// A command as text. A list of words is joined with spaces, as PowerShell's [string] did.
function commandText(value: unknown): string {
  if (Array.isArray(value)) return value.map((word) => String(word ?? '')).join(' ');
  return value === null || value === undefined ? '' : String(value);
}

// Only an explicit "no" leaves branch policies alone: nothing, false, 0, "false", "0", "", or a list of only those.
function isNo(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === 0) return true;
  if (typeof value === 'string') return ['', 'false', '0'].includes(value.trim().toLowerCase());
  return Array.isArray(value) && value.every(isNo);
}

// Why a tool call is denied, or null to let it run. toolArgs may be an object or a JSON string.
export function guardDecision(toolName: string, toolArgs: unknown, prefix: string | null = null): string | null {
  let args = toolArgs;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      // Not JSON: the text is the command itself.
    }
    if (typeof args === 'string') args = { command: args };
  }

  // The shell tools, plus MCP process tools (such as Desktop Commander's) that run commands or type into a shell.
  if (oneOf(toolName, ['powershell', 'bash']) || /(start_process|interact_with_process)$/i.test(toolName)) {
    const command = commandText(prop(args, 'command')) || commandText(prop(args, 'input'));
    if (/ASDF-GUARD-SELFTEST/i.test(command)) return 'ASDF guard: self-test, blocked as expected.';
    if (ADO_CLI.test(command)) return 'ASDF guard: Azure DevOps is reached only through the Azure DevOps MCP server, never the az CLI.';
    if (HTTP_CLIENT.test(command) && ADO_HOST.test(command)) {
      return 'ASDF guard: Azure DevOps is reached only through the Azure DevOps MCP server, never REST calls.';
    }
    for (const segment of command.split(/&&|\|\||[;|\r\n]/)) {
      const reason = gitPushReason(segment, prefix);
      if (reason) return reason;
    }
    return null;
  }

  const isVote = toList(prop(args, 'action')).some((action) => typeof action === 'string' && same(action.trim(), 'vote'));
  if (/repo_pull_request_write$/i.test(toolName) && isVote) return 'ASDF guard: ASDF never votes on pull requests.';
  if (!isNo(prop(args, 'bypassPolicy'))) return 'ASDF guard: branch policies are never bypassed.';
  return null;
}
