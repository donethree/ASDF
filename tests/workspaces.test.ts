import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { newItem, setItemRepo } from '../scripts/lib/items.ts';
import { getConfig, setConfig } from '../scripts/lib/settings.ts';
import { convertRemoteUrl, resolveWorkspace } from '../scripts/lib/workspaces.ts';
import { newContext, newWorkspace, type TestContext } from './helpers.ts';

describe('convertRemoteUrl', () => {
  const remotes: [url: string, repo: string][] = [
    ['https://contoso@dev.azure.com/contoso/Commerce/_git/Payments', 'contoso/Commerce/Payments'],
    ['https://dev.azure.com/contoso/Commerce/_git/Inventory', 'contoso/Commerce/Inventory'],
    ['https://contoso.visualstudio.com/DefaultCollection/Commerce/_git/Inventory', 'contoso/Commerce/Inventory'],
    ['https://contoso.visualstudio.com/Commerce/_git/_optimized/shared-lib', 'contoso/Commerce/shared-lib'],
    ['git@ssh.dev.azure.com:v3/contoso/Commerce/Payments', 'contoso/Commerce/Payments'],
    ['contoso@vs-ssh.visualstudio.com:v3/contoso/Commerce/Payments', 'contoso/Commerce/Payments'],
    ['https://dev.azure.com/contoso/My%20Project/_git/My%20Repo', 'contoso/My Project/My Repo'],
    ['https://onedrive.visualstudio.com/SharePoint%20Online/_git/SPO.Core', 'onedrive/SharePoint Online/SPO.Core'],
  ];
  for (const [url, expected] of remotes) {
    it(`reads ${url}`, () => {
      const repo = convertRemoteUrl(url);
      assert.equal(`${repo?.org}/${repo?.project}/${repo?.repo}`, expected);
    });
  }

  for (const url of ['https://github.com/contoso/tools.git', 'git@github.com:contoso/tools.git', '']) {
    it(`ignores '${url}'`, () => {
      assert.equal(convertRemoteUrl(url), null);
    });
  }
});

describe('workspaces', () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = newContext();
    newItem({ org: 'contoso', project: 'Storage', id: 7, kind: 'parent', type: 'Product Backlog Item', title: 'X' });
  });

  it('resolves any folder inside a checkout to the checkout and the repo it holds', () => {
    const deep = join(ctx.workspace, 'src', 'deep');
    mkdirSync(deep, { recursive: true });
    const workspace = resolveWorkspace(deep);
    assert.equal(`${workspace.name}|${workspace.org}|${workspace.project}|${workspace.repo}`, 'Storage|contoso|Storage|Storage');
    assert.ok(existsSync(join(workspace.path, 'src', 'deep')));
  });

  it('refuses a folder that is not an Azure DevOps checkout', () => {
    const plain = join(ctx.src, 'plain');
    mkdirSync(plain);
    const github = newWorkspace(join(ctx.src, 'gh'), 'https://github.com/contoso/tools.git');
    for (const path of [join(ctx.src, 'missing'), plain, github]) {
      assert.throws(() => resolveWorkspace(path), { code: 'ASDF_WORKSPACE_INVALID' }, path);
    }
  });

  it('records the workspace of the package a work item names, ignoring case', () => {
    const item = setItemRepo(7, 'storage');
    assert.deepEqual(item.repo, {
      name: 'Storage', org: 'contoso', project: 'Storage', clonePath: ctx.workspace, worktreePath: null, branch: 'user/jdoe/7-x',
    });
  });

  it('matches a workspace by folder name when no repo name matches', () => {
    const inventory = newWorkspace(join(ctx.src, 'inv'), 'https://dev.azure.com/contoso/Storage/_git/Inventory');
    setConfig({ ...getConfig(), workspaces: [ctx.workspace, inventory] });
    assert.equal(setItemRepo(7, 'inv').repo.name, 'Inventory');
  });

  it('lists the configured workspaces when none matches', () => {
    assert.throws(() => setItemRepo(7, 'Inventory'), { code: 'ASDF_NO_WORKSPACE', message: /Storage/ });
  });
});
