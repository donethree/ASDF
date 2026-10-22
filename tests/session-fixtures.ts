import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { artifactPath, atomicJson } from '../scripts/lib/artifacts.ts';
import { newItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { reserveBinding, runPath, type WorkerRequest } from '../scripts/lib/sessions.ts';
import { CLI, REPO, newContext } from './helpers.ts';

export function sessionFixture(writeRequest = true) {
  const ctx = newContext();
  newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Export' });
  setItemStage(42, 'new');
  const owner = randomUUID();
  lockItem(42, owner);
  const binding = reserveBinding(42, owner);
  const request: WorkerRequest = { schemaVersion: 1, backend: 'copilot-cli', item: binding.item,
    sessionId: binding.sessionId, runId: owner, owner, passId: 'pass-a', expectedStage: 'new',
    artifactRoot: artifactPath(42), mcpServer: 'ado-contoso',
    cli: { executable: process.execPath, script: CLI }, pluginRoot: REPO };
  if (writeRequest) atomicJson(runPath(42, owner, 'request.json'), request);
  return { ctx, binding, request };
}

export const fakeCli = join(REPO, 'tests', 'fixtures', 'fake-copilot.ts');
export const fakeExecutable = (mode = 'success') => ({ executable: process.execPath, prefixArgs: [fakeCli, '--scenario', mode] });
