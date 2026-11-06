import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, resolveConfig, LATEX_PROMPT, SECTION_NAME } from '../src/index.js';

/** A ctx double whose `inject` runs immediately against a recording systemPrompt. */
function fakeCtx() {
  const sections = [];
  const ctx = {
    inject(deps, fn) {
      assert.deepEqual(deps, ['systemPrompt']);
      fn({ systemPrompt: { section: (s) => { sections.push(s); return () => {}; } } });
    },
  };
  return { ctx, sections };
}

test('registers the LaTeX section for every agent by default', () => {
  const { ctx, sections } = fakeCtx();
  apply(ctx, undefined);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, SECTION_NAME);
  assert.equal(sections[0].interpolate, false, 'LaTeX braces must not be read as prompt variables');
  assert.equal(sections[0].text, LATEX_PROMPT.trim());
  assert.ok(Number.isFinite(sections[0].order));
});

test('prompt: false registers nothing', () => {
  const { ctx, sections } = fakeCtx();
  apply(ctx, { prompt: false });
  assert.equal(sections.length, 0);
});

test('promptText replaces the guidance', () => {
  const { ctx, sections } = fakeCtx();
  apply(ctx, { promptText: '  Use LaTeX.  ' });
  assert.equal(sections[0].text, 'Use LaTeX.');
});

test('rejects bad config', () => {
  assert.throws(() => resolveConfig({ prompt: 'yes' }), /boolean/);
  assert.throws(() => resolveConfig({ promptText: 3 }), /string/);
});

test('the prompt names every delimiter the renderer parses', () => {
  for (const delimiter of ['$...$', '$$', '\\(...\\)', '\\[']) {
    assert.ok(LATEX_PROMPT.includes(delimiter), delimiter);
  }
  assert.ok(!LATEX_PROMPT.includes('{{'), 'no accidental template syntax');
});
