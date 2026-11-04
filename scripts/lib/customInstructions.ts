import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { getItem } from './items.ts';
import { physical } from './localState.ts';
import { contextPath, getConfig } from './settings.ts';
import { fail, isObject, same } from './util.ts';
import type { Workspace } from './workspaces.ts';

export const PHASES = [
  'intake', 'featureBreakdown', 'investigation', 'design', 'designApproval', 'planning', 'checkout',
  'implementation', 'selfReview', 'pullRequest', 'prFeedback', 'merge', 'closeOut',
] as const;
export type Phase = typeof PHASES[number];
export type PhaseHooks = { before: string; after: string };
export type CustomInstructions = { schemaVersion: 1; phases: Record<Phase, PhaseHooks> };
export type RepositoryIdentity = { org: string; project: string; name: string };
export type RepositoryInstructions = CustomInstructions & { path: string; exists: boolean };

export function emptyCustomInstructions(): CustomInstructions {
  const phases = Object.fromEntries(PHASES.map(phase => [phase, { before: '', after: '' }])) as Record<Phase, PhaseHooks>;
  return { schemaVersion: 1, phases };
}

export function customInstructionsPath(context: string, repository: RepositoryIdentity): string {
  const code = 'ASDF_CUSTOM_INSTRUCTIONS_INVALID';
  if (!isAbsolute(context)) fail(code, 'custom instructions need an absolute context folder');
  const segment = (value: string) => {
    if (typeof value !== 'string' || !value.trim()) fail(code, 'custom instructions need the full repository identity');
    return encodeURIComponent(value.trim().toLowerCase()).replace(/[.!'()*]/g,
      char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  };
  const parts = ['custom-instructions',
    `org-${segment(repository.org)}`, `project-${segment(repository.project)}`, `repo-${segment(repository.name)}`, 'instructions.json'];
  const path = join(context, ...parts);
  const expected = join(physical(context, code), ...parts);
  const actual = physical(path, code);
  if ((process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)) {
    fail(code, `custom instruction paths must not redirect through directory or file links: ${path}`);
  }
  return path;
}

export function parseCustomInstructions(value: unknown, path: string): CustomInstructions {
  const invalid = (reason: string): never => fail('ASDF_CUSTOM_INSTRUCTIONS_INVALID', `${path}: ${reason}`);
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.phases)) {
    return invalid('expected schemaVersion 1 and a phases object');
  }
  const result = emptyCustomInstructions();
  for (const [phase, hooks] of Object.entries(value.phases)) {
    if (!PHASES.some(name => name === phase)) invalid(`unknown phase ${phase}`);
    if (!isObject(hooks)) return invalid(`${phase} must have before/after string instructions`);
    for (const key of Object.keys(hooks)) {
      if (key !== 'before' && key !== 'after') invalid(`unknown ${phase} hook ${key}`);
    }
    for (const timing of ['before', 'after'] as const) {
      const instruction: unknown = hooks[timing];
      if (instruction === undefined) continue;
      if (typeof instruction !== 'string') return invalid(`${phase}.${timing} must be a string`);
      result.phases[phase as Phase][timing] = instruction;
    }
  }
  return result;
}

export function readCustomInstructions(context: string, repository: RepositoryIdentity): RepositoryInstructions {
  const path = customInstructionsPath(context, repository);
  let source: string;
  try { source = readFileSync(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...emptyCustomInstructions(), path, exists: false };
    fail('ASDF_CUSTOM_INSTRUCTIONS_INVALID', `cannot read ${path}: ${(error as Error).message}`);
  }
  let value: unknown;
  try { value = JSON.parse(source.replace(/^\uFEFF/, '')); }
  catch (error) { fail('ASDF_CUSTOM_INSTRUCTIONS_INVALID', `${path}: ${(error as Error).message}`); }
  return { ...parseCustomInstructions(value, path), path, exists: true };
}

function readPhase(repository: RepositoryIdentity, phase: string) {
  if (!PHASES.some(name => name === phase)) fail('ASDF_BAD_ARGUMENT', `-Phase must be one of ${PHASES.join(', ')}`);
  const instructions = readCustomInstructions(contextPath(), repository);
  return { path: instructions.path, exists: instructions.exists, phase, ...instructions.phases[phase as Phase] };
}

export function phaseInstructions(id: number, phase: string) {
  const repo = getItem(id).repo;
  if (!repo || !['org', 'project', 'name'].every(key => typeof repo[key] === 'string' && repo[key])) {
    fail('ASDF_REPO_REQUIRED', `item ${id} needs a recorded repository before loading phase instructions`);
  }
  return readPhase(repo, phase);
}

export function repositoryPhaseInstructions(repository: RepositoryIdentity, phase: string) {
  const workspaces: Workspace[] = getConfig()?.workspaces ?? [];
  const workspace = workspaces.find(value => same(value.org, repository.org)
    && same(value.project, repository.project) && same(value.repo, repository.name));
  if (!workspace) fail('ASDF_NO_WORKSPACE', `no configured workspace for ${repository.org}/${repository.project}/${repository.name}`);
  return readPhase({ org: workspace.org, project: workspace.project, name: workspace.repo }, phase);
}
