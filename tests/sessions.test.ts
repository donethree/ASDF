import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { getItem, itemPath, newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { confirmBinding, readBinding, reserveBinding } from '../scripts/lib/sessions.ts';
import { newContext, newFolder } from './helpers.ts';

describe('persistent session bindings', () => {
  beforeEach(() => {
    newContext();
    newItem({ id: 42, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Export ../ not a path' });
    setItemStage(42, 'new');
    lockItem(42, 'owner');
  });

  it('reserves one stable identity without changing workflow state', () => {
    const first = reserveBinding(42, 'owner');
    setItem(42, { title: 'renamed' });
    assert.deepEqual(reserveBinding(42, 'owner'), first);
    assert.match(first.sessionId, /^[a-f0-9-]{36}$/);
    assert.equal(first.provisioning, 'reserved');
    assert.equal(getItem(42).stage, 'new');
    assert.equal(readBinding(42)?.item.id, 42);
    assert.equal(confirmBinding(42, 'owner', first.sessionId).provisioning, 'confirmed');
  });

  it('does not replace a corrupt binding', () => {
    reserveBinding(42, 'owner');
    const file = join(itemPath(42)!, 'session', 'binding.json');
    writeFileSync(file, '{broken');
    assert.throws(() => reserveBinding(42, 'owner'), { code: 'ASDF_SESSION_STATE_INVALID' });
    assert.equal(readFileSync(file, 'utf8'), '{broken');
  });

  it('does not interpret a JSON null binding as absent history', () => {
    reserveBinding(42, 'owner');
    const file = join(itemPath(42)!, 'session', 'binding.json');
    writeFileSync(file, 'null');
    assert.throws(() => reserveBinding(42, 'owner'), { code: 'ASDF_SESSION_STATE_INVALID' });
    assert.equal(readFileSync(file, 'utf8'), 'null');
  });

  it('rejects another item identity and another session confirmation', () => {
    const first = reserveBinding(42, 'owner');
    assert.throws(() => confirmBinding(42, 'owner', '00000000-0000-4000-8000-000000000000'), { code: 'ASDF_SESSION_STATE_INVALID' });
    const file = join(itemPath(42)!, 'session', 'binding.json');
    writeFileSync(file, JSON.stringify({ ...first, item: { ...first.item, org: 'fabrikam' } }));
    assert.throws(() => readBinding(42), { code: 'ASDF_SESSION_STATE_INVALID' });
  });

  it('rejects foreign ownership before allocating', () => {
    assert.throws(() => reserveBinding(42, 'other'), { code: 'ASDF_LOCK_NOT_OWNER' });
    assert.equal(readBinding(42), null);
  });

  it('rejects a session junction escaping the item', () => {
    const outside = newFolder('outside');
    symlinkSync(outside, join(itemPath(42)!, 'session'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => reserveBinding(42, 'owner'), { code: 'ASDF_ARTIFACT_PATH' });
  });

  it('rejects a directory substituted for a record', () => {
    mkdirSync(join(itemPath(42)!, 'session', 'binding.json'), { recursive: true });
    assert.throws(() => readBinding(42), { code: 'ASDF_SESSION_STATE_INVALID' });
  });
});
