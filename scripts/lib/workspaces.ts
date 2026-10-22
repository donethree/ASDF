// Workspaces: the local checkouts listed in init, and the Azure DevOps repo each one holds.
// ASDF never searches the disk for code; an item's code is in the workspace of the package its work item names.
import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fail, git } from './util.ts';

export interface RemoteRepo {
  org: string;
  project: string;
  repo: string;
}

export interface Workspace extends RemoteRepo {
  path: string;
  name: string;
}

const REMOTE_PATTERNS = [
  /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/(?<org>[^/]+)\/(?<project>[^/]+)\/_git\/(?:_(?:full|optimized)\/)?(?<repo>[^/?#]+?)(?:\.git)?\/?$/i,
  /^https:\/\/(?:[^@/]+@)?(?<org>[^./@]+)\.visualstudio\.com\/(?:DefaultCollection\/)?(?<project>[^/]+)\/_git\/(?:_(?:full|optimized)\/)?(?<repo>[^/?#]+?)(?:\.git)?\/?$/i,
  /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com[:/]v3\/(?<org>[^/]+)\/(?<project>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i,
  /^(?:ssh:\/\/)?[^@/]+@vs-ssh\.visualstudio\.com[:/]v3\/(?<org>[^/]+)\/(?<project>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i,
];

function unescape(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// An Azure DevOps remote URL as org, project and repo; null for any other URL.
export function convertRemoteUrl(url: string): RemoteRepo | null {
  for (const pattern of REMOTE_PATTERNS) {
    const groups = pattern.exec(url.trim())?.groups;
    if (groups) return { org: unescape(groups.org), project: unescape(groups.project), repo: unescape(groups.repo) };
  }
  return null;
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// A local checkout as its root folder, folder name, and the Azure DevOps repo its origin remote points to.
export function resolveWorkspace(path: string): Workspace {
  if (!isFolder(path)) fail('ASDF_WORKSPACE_INVALID', `workspace ${path} does not exist`);
  const prefix = git(path, ['rev-parse', '--show-prefix']);
  if (prefix.code !== 0) fail('ASDF_WORKSPACE_INVALID', `workspace ${path} is not a git checkout`);
  // Keep the folder as given when it is the checkout's root; otherwise use the root git reports.
  const root = prefix.out.trim() ? git(path, ['rev-parse', '--show-toplevel']).out.trim() : path;
  const origin = git(path, ['remote', 'get-url', 'origin']);
  const repo = origin.code === 0 ? convertRemoteUrl(origin.out) : null;
  if (!repo) fail('ASDF_WORKSPACE_INVALID', `the origin remote of workspace ${path} is not an Azure DevOps repo`);
  const full = resolve(root.trim());
  return { path: full, name: basename(full), ...repo };
}
