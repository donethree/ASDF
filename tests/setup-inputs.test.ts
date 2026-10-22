import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseOrganization, parseProject, parseWatchSource, prepareRepository, sameSource } from '../scripts/lib/setupInputs.ts';
import { newFolder, newWorkspace } from './helpers.ts';

describe('guided setup inputs', () => {
  it('parses organization and project examples without network access', () => {
    assert.deepEqual(parseOrganization('https://dev.azure.com/contoso'), { org: 'contoso' });
    assert.deepEqual(parseOrganization('contoso'), { org: 'contoso' });
    assert.deepEqual(parseProject('Commerce', 'contoso'), { org: 'contoso', project: 'Commerce' });
    assert.deepEqual(parseProject('contoso/Commerce'), { org: 'contoso', project: 'Commerce' });
    assert.deepEqual(parseProject('https://contoso.visualstudio.com/DefaultCollection/Shared%20Tools'),
      { org: 'contoso', project: 'Shared Tools' });
  });
  it('treats backlog levels and display parameters as views of the same team', () => {
    const first = parseWatchSource('https://dev.azure.com/contoso/Commerce/_backlogs/backlog/Data%20Movement/Features?showParents=false');
    assert.deepEqual(first, { org: 'contoso', project: 'Commerce', scope: { kind: 'team', team: 'Data Movement' } });
    assert.equal(sameSource(first, parseWatchSource('https://dev.azure.com/CONTOSO/commerce/_backlogs/backlog/data%20movement/Backlog%20items')), true);
    assert.deepEqual(parseWatchSource('https://dev.azure.com/contoso/Commerce/_backlogs/directory'),
      { org: 'contoso', project: 'Commerce', scope: { kind: 'project', areaPaths: [] } });
  });
  for (const input of [
    'https://dev.azure.com/contoso/Commerce/_git/Payments',
    'https://example.com/contoso/Commerce',
    'https://dev.azure.com/contoso/Commerce/_backlogs/backlog//Features',
    'https://dev.azure.com/contoso/Bad%ZZ',
    'https://dev.azure.com/contoso/Bad%E0%A4',
    'https://dev.azure.com/contoso/Commerce/unknown',
    'https://dev.azure.com/contoso/Bad%2FProject',
    'contoso/Commerce\nother',
  ]) {
    it(`rejects ambiguous or malformed watch input ${JSON.stringify(input)}`, () => {
      assert.throws(() => parseWatchSource(input), { code: 'ASDF_SETUP_INPUT_INVALID' });
    });
  }
  it('requires an existing matching checkout without treating commas as separators', () => {
    const path = newWorkspace(join(newFolder(), 'Payments, Legacy'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    assert.equal(prepareRepository(path).path, path);
    assert.equal(prepareRepository('https://dev.azure.com/contoso/Commerce/_git/Payments', path).repo, 'Payments');
    assert.throws(() => prepareRepository('https://dev.azure.com/contoso/Commerce/_git/Payments'), { code: 'ASDF_SETUP_CHECKOUT_REQUIRED' });
    assert.throws(() => prepareRepository('https://dev.azure.com/contoso/Commerce/_git/Other', path), { code: 'ASDF_SETUP_REPO_MISMATCH' });
  });

  it('accepts repository browser view parameters without changing repository identity', () => {
    const path = newWorkspace(join(newFolder(), 'Payments'), 'https://dev.azure.com/contoso/Commerce/_git/Payments');
    for (const suffix of ['?path=/src', '?version=GBmain', '?path=%2Fsrc&version=GBmain#file']) {
      assert.equal(prepareRepository(`https://dev.azure.com/contoso/Commerce/_git/Payments${suffix}`, path).repo, 'Payments');
    }
  });
});
