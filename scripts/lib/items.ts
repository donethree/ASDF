// Item folders under asdf-context: <id>-<slug>/state.json plus diagrams/ and reviews/. State and stage changes.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { branchPrefix, contextPath, getConfig, withSettingsGuard } from './settings.ts';
import { fail, isObject, now, oneOf, prop, readJson, same, stamp, toList, writeJson, type Json } from './util.ts';
import { assertDesignCanAdvance } from './approval.ts';

export const STAGES = [
  'tracked', 'awaiting-parent', 'new', 'awaiting-answers', 'answers-received', 'awaiting-approval', 'approved',
  'awaiting-pbis', 'pbis-done',
  'implementing', 'self-review', 'pr-open', 'pr-feedback', 'pr-ready', 'merging', 'merged', 'done', 'blocked', 'paused',
] as const;

// do-next queue priority (lower runs first); stages without an entry are waiting on someone else.
export const STAGE_PRIORITY: Readonly<Record<string, number>> = {
  'pr-feedback': 1, 'pr-ready': 2, 'merged': 2, 'pbis-done': 2, 'implementing': 3, 'self-review': 3,
  'approved': 4, 'answers-received': 5, 'new': 6,
};

const KINDS = ['parent', 'task', 'feature'];
const FORBIDDEN_PATCH_KEYS = ['id', 'stage', 'resumeStage', 'stats'];

// A folder-safe slug: accents dropped, lower case, dashes between words, at most 40 characters cut at a word.
export function slugify(title: string): string {
  let slug = title.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > 40) {
    const cut = slug.substring(0, 41).lastIndexOf('-');
    slug = (cut > 0 ? slug.substring(0, cut) : slug.substring(0, 40)).replace(/^-+|-+$/g, '');
  }
  return slug || 'item';
}

export function itemPath(id: number): string | null {
  const context = contextPath();
  let names: string[];
  try {
    names = readdirSync(context, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return null;
  }
  const name = names.filter((n) => n.startsWith(`${id}-`)).sort()[0];
  return name === undefined ? null : join(context, name);
}

export function getItem(id: number): Json {
  const path = itemPath(id);
  if (!path || !existsSync(join(path, 'state.json'))) fail('ASDF_ITEM_NOT_FOUND', String(id));
  return readJson(join(path, 'state.json'));
}

// Every tracked item, or those at one of the given stages.
export function getItems(stages: string[] = []): Json[] {
  const context = contextPath();
  if (!existsSync(context)) return [];
  const folders = readdirSync(context, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+-/.test(e.name))
    .map((e) => e.name)
    .sort();
  const items: Json[] = [];
  for (const folder of folders) {
    const file = join(context, folder, 'state.json');
    if (!existsSync(file)) continue;
    const state = readJson(file);
    if (stages.length === 0 || oneOf(state.stage, stages)) items.push(state);
  }
  return items;
}

export interface NewItem {
  org: string;
  project: string;
  id: number;
  kind: string;
  type: string;
  title: string;
  parentId?: number | null;
  now?: string | Date;
}

// Roles may be recorded after an older pass already tracked the child. Queueing rechecks them.
export function managedChildReason(item: Json, items: Json[]): string | null {
  const unstarted = (item.stage === undefined || oneOf(item.stage, ['tracked', 'new', 'awaiting-parent']))
    && !item.ado?.prId && !item.repo?.worktreePath
    && !item.hld?.roundPostedAt && !item.hld?.approvalRequestedAt && !item.hld?.version;
  for (const other of items) {
    if (!same(other.org, item.org) || other.id === item.id) continue;
    const ado = prop(other, 'ado');
    const roles: [string, Json][] = [['HLD', prop(ado, 'hldId')], ['Review', prop(ado, 'reviewId')], ['implementation', prop(ado, 'implIds')]];
    for (const [role, ids] of roles) {
      if (toList(ids).some((id) => String(id) === String(item.id))) return `${item.id} is the ${role} task of item ${other.id}`;
    }
    if (unstarted && same(item.kind, 'task') && same(other.kind, 'parent') && !oneOf(other.stage, ['done', 'paused'])
      && String(prop(prop(item, 'ado'), 'parentId')) === String(other.id)) {
      return `${item.id} belongs to tracked parent ${other.id}`;
    }
  }
  if (same(item.kind, 'task') && prop(prop(item, 'ado'), 'parentId') && /^(HLD|Design|Breakdown)\b/i.test(String(item.title))) {
    return `${item.id} is a design task, not an independent development item`;
  }
  return null;
}

export function newItem(input: NewItem): Json {
  return withSettingsGuard(() => createItem(input));
}

function createItem(input: NewItem): Json {
  const { org, project, id, type, title } = input;
  const kind = KINDS.find((k) => same(k, input.kind));
  if (!kind) fail('ASDF_BAD_ARGUMENT', `-Kind must be parent, task or feature, not '${input.kind}'`);
  const existing = itemPath(id) ? getItem(id) : null;
  if (existing) {
    // Work item ids are unique per org only, and item folders are named by id.
    if (existing.org && !same(existing.org, org)) {
      fail('ASDF_ID_CLASH', `${id} is already tracked for org ${existing.org}; ASDF can't also track ${org} item ${id}`);
    }
  }
  const candidate = { ...(existing ?? input), kind, ado: { ...existing?.ado, parentId: input.parentId ?? existing?.ado?.parentId } };
  const managed = managedChildReason(candidate, getItems());
  if (managed) fail('ASDF_OWN_TASK', `${managed}; ASDF never tracks it as an item of its own`);
  if (existing) return existing;
  const slug = slugify(title);
  const prefix = branchPrefix();
  const path = join(contextPath(), `${id}-${slug}`);
  for (const sub of ['diagrams', 'reviews']) mkdirSync(join(path, sub), { recursive: true });
  // A Feature is never built itself, so it has no branch; its PBIs do.
  const branch = prefix && kind !== 'feature' ? `${prefix}/${id}-${slug}` : null;
  const state = {
    schemaVersion: 1, id, org, project, kind, route: null, size: null, type,
    title, slug, stage: 'tracked', resumeStage: null, lastReason: null,
    ado: { parentId: input.parentId ?? null, hldId: null, hldOwned: false, reviewId: null, implIds: [], prId: null, pbis: [] },
    repo: { name: null, org: null, project: null, clonePath: null, worktreePath: null, branch },
    hld: { version: 0, roundPostedAt: null, approvalRequestedAt: null, approvedBy: null, approvedAt: null, closedAt: null },
    blocker: { workItemId: null, commentAt: null, reason: null },
    stats: { stageEnteredAt: { tracked: stamp(now(input.now)) }, questionRounds: 0, prRounds: 0 },
  };
  writeJson(join(path, 'state.json'), state);
  return getItem(id);
}

function merge(target: Record<string, Json>, patch: Record<string, Json>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (isObject(value) && isObject(target[key])) merge(target[key], value);
    else target[key] = value;
  }
}

function saveItem(id: number, state: Json): Json {
  writeJson(join(itemPath(id)!, 'state.json'), state);
  return getItem(id);
}

// Merges a patch into an item's state. The stage and the stats move only through setItemStage.
export function setItem(id: number, patch: Json): Json {
  if (!isObject(patch)) fail('ASDF_BAD_ARGUMENT', 'the patch must be a JSON object');
  const forbidden = FORBIDDEN_PATCH_KEYS.find((key) => Object.hasOwn(patch, key));
  if (forbidden) fail('ASDF_PATCH_FORBIDDEN_KEY', forbidden);
  const state = getItem(id);
  merge(state, patch);
  return saveItem(id, state);
}

export function setItemStage(id: number, stageName: string, reason?: string, workItemId?: number | null, at?: string | Date): Json {
  const stage = STAGES.find((s) => same(s, stageName));
  if (!stage) fail('ASDF_STAGE_UNKNOWN', stageName);
  if (stage === 'blocked' && !reason) {
    fail('ASDF_REASON_REQUIRED', 'blocking an item needs -Reason, the reason given in its blocker comment');
  }
  const time = stamp(now(at));
  const state = getItem(id);
  const previous = state.stage;
  assertDesignCanAdvance(state, stage);
  if (stage === 'blocked' || stage === 'paused') {
    if (!oneOf(previous, ['blocked', 'paused'])) state.resumeStage = previous;
  } else {
    state.resumeStage = null;
  }
  // The blocker comment was just posted: replies newer than now unblock the item (signal rule 10).
  if (stage === 'blocked') {
    state.blocker = { workItemId: workItemId ?? id, commentAt: time, reason };
  } else if (stage !== 'paused') {
    state.blocker = { workItemId: null, commentAt: null, reason: null };
  }
  state.stage = stage;
  state.stats ??= {};
  state.stats.stageEnteredAt ??= {};
  state.stats.stageEnteredAt[stage] = time;
  if (stage === 'awaiting-answers') state.stats.questionRounds = Number(state.stats.questionRounds ?? 0) + 1;
  if (stage === 'pr-feedback') state.stats.prRounds = Number(state.stats.prRounds ?? 0) + 1;
  if (reason !== undefined) state.lastReason = reason;
  return saveItem(id, state);
}

// Records an item's workspace: the one whose repo name, or else folder name, is the package its work item names.
export function setItemRepo(id: number, name: string, org?: string, project?: string): Json {
  const workspaces = toList(prop(getConfig(), 'workspaces'))
    .filter((w) => (org === undefined || same(prop(w, 'org'), org)) && (project === undefined || same(prop(w, 'project'), project)));
  let found = workspaces.filter((w) => same(prop(w, 'repo'), name));
  if (found.length === 0) found = workspaces.filter((w) => same(prop(w, 'name'), name));
  if (found.length !== 1) {
    const known = workspaces.map((w) => `${prop(w, 'org')}/${prop(w, 'project')}/${prop(w, 'repo')} (${prop(w, 'path')})`).join(', ');
    fail('ASDF_NO_WORKSPACE', `no single workspace holds '${name}'. Configured workspaces: ${known}`);
  }
  const [workspace] = found;
  return setItem(id, { repo: { name: workspace.repo, org: workspace.org, project: workspace.project, clonePath: workspace.path } });
}
