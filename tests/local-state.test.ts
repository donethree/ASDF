import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { it, mock } from 'node:test';
import { newItem } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { settingsPath } from '../scripts/lib/settings.ts';
import { newContext, REPO } from './helpers.ts';

it('retries an unreadable contender marker without reclaiming its live holder', async () => {
  newContext();
  newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Guard contention' });
  const child = spawn(process.execPath, [join(REPO, 'tests', 'fixtures', 'settings-race.ts'), 'hold'], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  const original = fs.readFileSync;
  let mocked: ReturnType<typeof mock.method> | undefined;
  try {
    await once(child.stdout, 'data');
    let denied = false;
    mocked = mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
      if (!denied && String(args[0]).includes('.setup-guard') && String(args[0]).endsWith('.json')) {
        denied = true;
        throw Object.assign(new Error('temporary Windows sharing violation'), { code: 'EPERM' });
      }
      return Reflect.apply(original, fs, args);
    });
    syncBuiltinESMExports();
    assert.equal(lockItem(42, 'next').acquired, true);
    assert.equal(fs.existsSync(settingsPath() + '.held'), false);
    await closed;
  } finally {
    mocked?.mock.restore();
    syncBuiltinESMExports();
    child.kill();
  }
});
