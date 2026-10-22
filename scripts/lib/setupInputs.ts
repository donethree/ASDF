import { isAbsolute } from 'node:path';
import { convertRemoteUrl, resolveWorkspace, type Workspace } from './workspaces.ts';
import { scopeKey, type ProjectIdentity, type WatchSource } from './watchScopes.ts';
import { fail, same } from './util.ts';

function invalid(message: string): never { return fail('ASDF_SETUP_INPUT_INVALID', message); }
function clean(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value) || !value.trim()) invalid('enter one nonempty value without control characters');
  return value.trim();
}
function decode(value: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(value); }
  catch { return invalid('URL has invalid percent encoding; paste the complete browser URL'); }
  if (!decoded.trim() || /[\\/\u0000-\u001f\u007f]/.test(decoded) || decoded === '.' || decoded === '..') invalid('URL contains an empty or invalid identity segment');
  return decoded;
}
function adoUrl(input: string): { org: string; parts: string[] } {
  let url: URL;
  try { url = new URL(input); } catch { return invalid('paste a full Azure DevOps URL'); }
  if (url.protocol !== 'https:' || url.password || url.port) invalid('use an HTTPS Azure DevOps URL without a password or custom port');
  const raw = url.pathname.replace(/^\/|\/$/g, '').split('/');
  const parts = raw[0] === '' ? [] : raw.map(decode);
  if (url.hostname.toLowerCase() === 'dev.azure.com') {
    if (!parts.length) invalid('URL needs an organization');
    return { org: parts[0], parts: parts.slice(1) };
  }
  const legacy = /^([a-z0-9-]+)\.visualstudio\.com$/i.exec(url.hostname);
  if (!legacy) invalid('expected dev.azure.com or an organization.visualstudio.com URL');
  if (parts[0]?.toLowerCase() === 'defaultcollection') parts.shift();
  return { org: legacy[1], parts };
}

export function parseOrganization(input: string): { org: string } {
  input = clean(input);
  if (input.includes('://')) {
    const parsed = adoUrl(input);
    if (parsed.parts.length) invalid('enter the organization name or its organization URL, not a project/repository URL');
    return { org: parsed.org };
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(input)) invalid('enter an organization name such as contoso');
  return { org: input };
}

export function parseProject(input: string, selectedOrg?: string): ProjectIdentity {
  input = clean(input);
  if (input.includes('://')) {
    const parsed = adoUrl(input);
    if (parsed.parts.length !== 1) invalid('paste the project URL ending in its project name');
    return { org: parsed.org, project: parsed.parts[0] };
  }
  const parts = input.split('/');
  if (parts.length === 2) return { org: parseOrganization(parts[0]).org, project: decode(parts[1]) };
  if (parts.length === 1 && selectedOrg) return { org: parseOrganization(selectedOrg).org, project: decode(input) };
  return invalid('enter org/project, a full project URL, or select an organization first');
}

export function parseWatchSource(input: string, selectedOrg?: string): WatchSource {
  input = clean(input);
  if (!input.includes('://')) return { ...parseProject(input, selectedOrg), scope: { kind: 'project', areaPaths: [] } };
  const { org, parts } = adoUrl(input);
  if (parts.length === 1 || (parts[1] === '_backlogs' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'directory')))) {
    return { org, project: parts[0], scope: { kind: 'project', areaPaths: [] } };
  }
  if (parts.length === 5 && parts[1] === '_backlogs' && parts[2] === 'backlog') {
    return { org, project: parts[0], scope: { kind: 'team', team: parts[3] } };
  }
  if (parts.includes('_git')) invalid('this is a code repository URL; add it under Repositories, then choose a project or team backlog to watch');
  return invalid('paste a project URL or a named team backlog URL ending in /_backlogs/backlog/<team>/<level>');
}

export function prepareRepository(input: string, checkoutPath?: string): Workspace {
  input = clean(input);
  if (/^https?:\/\//i.test(input)) {
    adoUrl(input);
    const url = new URL(input);
    url.search = '';
    url.hash = '';
    input = url.href;
  }
  try { decodeURIComponent(input); } catch { invalid('repository input contains invalid percent encoding'); }
  const remote = convertRemoteUrl(input);
  if (remote) {
    if (!checkoutPath?.trim()) fail('ASDF_SETUP_CHECKOUT_REQUIRED', 'enter the existing local checkout folder; ASDF does not clone repositories');
    const workspace = resolveWorkspace(clean(checkoutPath));
    if (!same(workspace.org, remote.org) || !same(workspace.project, remote.project) || !same(workspace.repo, remote.repo)) {
      fail('ASDF_SETUP_REPO_MISMATCH', `checkout origin is ${workspace.org}/${workspace.project}/${workspace.repo}, not the supplied repository`);
    }
    return workspace;
  }
  if (!isAbsolute(input)) invalid('enter a full Azure DevOps repository URL or absolute local checkout folder');
  return resolveWorkspace(input);
}

export function sameSource(a: WatchSource, b: WatchSource): boolean {
  return same(a.org, b.org) && same(a.project, b.project) && scopeKey(a.scope) === scopeKey(b.scope);
}
