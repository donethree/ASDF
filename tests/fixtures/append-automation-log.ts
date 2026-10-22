import { recordAutomationEvent } from '../../scripts/lib/automationLog.ts';
const results = [0, 1, 2].map(i => recordAutomationEvent({
  passId: `${process.argv[2]}-${i}`, action: 'pass-finished', outcome: 'no-actionable-work',
}, new Date('2026-10-22T12:00:00Z')));
console.log(JSON.stringify({ written: results.every(r => r.written), results }));
