import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import { newItem } from '../scripts/lib/items.ts';
import { withSettingsGuard } from '../scripts/lib/settings.ts';
import { newContext, newFolder, REPO } from './helpers.ts';

describe('settings coordination', () => {
  it('keeps item acquisition outside an in-flight setup transaction', async () => {
    newContext();
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
    const script = join(REPO, 'tests', 'fixtures', 'settings-race.ts');
    const child = spawn(process.execPath, [script, 'hold'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    try {
      await once(child.stdout, 'data');
      const result = await promisify(execFile)(process.execPath, [script, 'lock'], { env: process.env });
      assert.deepEqual(JSON.parse(result.stdout), { acquired: true, owner: 'new-operation', tookOver: false, observedHeld: false });
      await closed;
    } finally { child.kill(); }
  });

  it('supports reentrancy and distinct settings files', () => {
    const a = join(newFolder(), 'a.json');
    const b = join(newFolder(), 'b.json');
    assert.equal(withSettingsGuard(() => withSettingsGuard(() => withSettingsGuard(() => 'ok', b), a), a), 'ok');
  });

  it('serializes short state mutations with settings saves too', async () => {
    newContext();
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Work' });
    const script = join(REPO, 'tests', 'fixtures', 'settings-race.ts');
    const child = spawn(process.execPath, [script, 'hold'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    try {
      await once(child.stdout, 'data');
      const result = await promisify(execFile)(process.execPath, [script, 'stage'], { env: process.env });
      assert.deepEqual(JSON.parse(result.stdout), { code: 0, observedHeld: false });
      await closed;
    } finally { child.kill(); }
  });
});
