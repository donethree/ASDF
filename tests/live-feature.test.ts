import assert from 'node:assert/strict';
import { it } from 'node:test';
import { newItem, setItem, setItemStage } from '../scripts/lib/items.ts';
import { selectLiveChild } from '../scripts/lib/liveContinuation.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { newContext } from './helpers.ts';

it('selects ready children in breakdown order without starting gated or owned work', () => {
  newContext();
  newItem({ id: 50, org: 'contoso', project: 'Storage', kind: 'feature', type: 'Feature', title: 'Feature' });
  setItem(50, { ado: { pbis: [{ id: 42, waitsFor: [] }, { id: 43, waitsFor: [42] }, { id: 44, waitsFor: [] }] } });
  for (const id of [42, 43, 44]) {
    newItem({ id, org: 'contoso', project: 'Storage', kind: 'parent', type: 'User Story', title: 'Child', parentId: 50 });
    setItemStage(id, 'new');
  }
  const children = [42, 43, 44].map(id => ({ id, parentId: 50, type: 'User Story', assignedToMe: true, stateCategory: 'InProgress' }));
  assert.equal(selectLiveChild(50, children, []).id, 42);
  lockItem(42, 'other');
  assert.deepEqual(selectLiveChild(50, children, []), { id: 44, deferred: [42, 43] });
  assert.equal(selectLiveChild(50, children, [44]).id, null);
  children[0].stateCategory = 'Completed';
  children[1].stateCategory = 'Proposed';
  assert.equal(selectLiveChild(50, children, [44]).id, null);
  children[1].stateCategory = 'InProgress';
  assert.equal(selectLiveChild(50, children, [44]).id, 43);
  assert.throws(() => selectLiveChild(50, children.slice(1), []), { code: 'ASDF_LIVE_REFRESH_INCOMPLETE' });
});
