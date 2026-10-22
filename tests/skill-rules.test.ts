// Sentences each skill must keep word for word, listed in skill-rules.json. Each one carries a rule that
// scenarios or other skills rely on, so rewording it is a deliberate change: update skill-rules.json too.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.ts';

const rules: Record<string, string[]> = JSON.parse(readFileSync(join(REPO, 'tests', 'skill-rules.json'), 'utf8'));

for (const [skill, sentences] of Object.entries(rules)) {
  describe(`${skill} keeps its required sentences`, () => {
    const text = readFileSync(join(REPO, 'skills', skill, 'SKILL.md'), 'utf8');
    for (const sentence of sentences) {
      it(sentence, () => assert.ok(text.includes(sentence)));
    }
  });
}
