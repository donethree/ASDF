import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newItem, setItemStage } from '../scripts/lib/items.ts';
import { lockItem } from '../scripts/lib/lock.ts';
import { getQueue } from '../scripts/lib/queue.ts';
import { newContext } from './helpers.ts';

const START = new Date('2026-10-20T08:00:00Z');
const minutesLater = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

describe('the work queue', () => {
  it('orders by priority, then by time at the stage, skipping waiting, blocked and locked items', () => {
    newContext();
    // Item n enters its stage n minutes after START.
    const stages = ['new', 'pr-feedback', 'implementing', 'awaiting-answers', 'pr-ready', 'blocked',
      'answers-received', 'implementing', 'approved', 'merged', 'self-review'];
    stages.forEach((stage, index) => {
      const id = index + 1;
      newItem({ org: 'contoso', project: 'Storage', id, kind: 'parent', type: 'Product Backlog Item', title: `I${id}`, now: START });
      setItemStage(id, stage, 'test', null, minutesLater(id));
    });
    lockItem(8, 'other pass', minutesLater(30));

    const queue = getQueue(minutesLater(40));

    assert.deepEqual(queue.map((item) => item.id), [2, 5, 10, 3, 11, 9, 7, 1]);
    assert.equal(queue[0].priority, 1);
    assert.match(queue[0].path, /2-i2$/);
  });

  it('works a Feature whose PBIs are finished, and leaves a waiting one alone', () => {
    newContext();
    const items: [number, string, string][] = [[1, 'feature', 'pbis-done'], [2, 'feature', 'awaiting-pbis'], [3, 'parent', 'approved']];
    for (const [id, kind, stage] of items) {
      newItem({ org: 'contoso', project: 'Storage', id, kind, type: kind === 'feature' ? 'Feature' : 'Product Backlog Item', title: `I${id}`, now: START });
      setItemStage(id, stage, 'test', null, minutesLater(id));
    }

    assert.deepEqual(getQueue(minutesLater(10)).map((item) => item.id), [1, 3]);
  });
});
