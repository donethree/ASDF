import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { setSettings } from '../scripts/lib/settings.ts';
import { copyPlugin, newFolder, runHook, uninitialized } from './helpers.ts';

describe('session-start hook', () => {
  let plugin: string;
  before(() => {
    plugin = copyPlugin();
  });

  function startSession(): { code: number | null; context: string } {
    const { code, out } = runHook(plugin, 'session-start.ts', '{"sessionId":"s","timestamp":0,"cwd":"C:\\\\x","source":"new"}');
    return { code, context: JSON.parse(out).additionalContext };
  }

  it('gives a manual setup command and the plugin paths without running a setup skill', () => {
    uninitialized();
    const { code, context } = startSession();
    assert.equal(code, 0);
    assert.match(context, /^ASDF is active\./);
    assert.ok(context.includes(`node "${join(plugin, 'asdf.js')}" --init`));
    assert.match(context, /manually/);
    assert.ok(context.includes(`ASDF plugin root: ${plugin}`));
    assert.ok(context.includes(`ASDF CLI: node "${join(plugin, 'scripts', 'asdf.ts')}" <command>`));
    assert.ok(context.includes('No work starts without a Feature, PBI, User Story, or Task.'));
    assert.doesNotMatch(context, /^name: using-asdf/m);
  });

  it('gives the context path once ASDF is initialized', () => {
    uninitialized();
    const context = join(newFolder(), 'my ctx');
    setSettings(context);
    assert.ok(startSession().context.includes(`asdf-context: ${context}`));
  });

  it('stays valid JSON when the settings file is corrupt', () => {
    writeFileSync(uninitialized(), '{ not json');
    const { code, context } = startSession();
    assert.equal(code, 0);
    assert.match(context, /not initialized/);
  });
});
