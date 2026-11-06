import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClient } from './helpers.js';

const client = loadClient();
const { mayContainMath, planStream, findUnclosedInline, closePartialFormula, install } = client;

/** JSON round-trip: objects from the vm realm have a foreign prototype. */
const plain = (value) => JSON.parse(JSON.stringify(value));

test('detects math outside code only', () => {
  assert.equal(mayContainMath('plain prose'), false);
  assert.equal(mayContainMath('energy $E = mc^2$'), true);
  assert.equal(mayContainMath('see \\(x\\)'), true);
  assert.equal(mayContainMath('$$\nx\n$$'), true);
  assert.equal(mayContainMath('```math\nx\n```'), true);
  assert.equal(mayContainMath('```bash\necho $HOME\n```'), false);
});

test('splits completed paragraphs into stable blocks', () => {
  const text = 'First $a$ para.\n\nSecond paragraph with $b$ here.\n\nThird is still gr';
  const plan = plain(planStream(text));
  assert.deepEqual(plan.segments.map((s) => s.text), [
    'First $a$ para.\n\n',
    'Second paragraph with $b$ here.\n\n',
  ]);
  assert.equal(plan.tail.text, 'Third is still gr');
  assert.equal(plan.tail.math, false);
  assert.equal(plan.pending, null);
});

test('keys stay stable as text grows', () => {
  const a = planStream('One $x$.\n\nTwo $y$.\n\nThree is long enough');
  const b = planStream('One $x$.\n\nTwo $y$.\n\nThree is long enough.\n\nFour is now growing');
  assert.deepEqual(plain(a.segments.map((s) => s.key)), plain(b.segments.slice(0, 2).map((s) => s.key)));
  assert.equal(a.tail.key, b.segments[2].key);
});

test('does not split inside lists, code fences or display math', () => {
  const list = 'Steps $n$:\n\n- one\n\n- two $x$ and more';
  assert.equal(planStream(list).segments.length, 0, 'list items are never split points');
  const fence = 'Intro $a$.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter the fence.';
  const fencePlan = plain(planStream(fence));
  assert.ok(fencePlan.segments.some((s) => s.text.includes('const a = 1;\n\nconst b = 2;')));
  const display = 'Text $a$.\n\n$$\na\n\nb\n$$\n\nAfter the formula.';
  const displayPlan = plain(planStream(display));
  assert.ok(displayPlan.segments.some((s) => s.text.startsWith('$$\na\n\nb\n$$')));
});

test('a short partial line is not yet a split point', () => {
  // "1" could become "1. item" (a list continuation), so it must not split.
  const plan = planStream('Intro $x$:\n\n- a\n\n1');
  assert.equal(plan.segments.length, 0);
});

test('unclosed inline math shows as escaped text until it closes', () => {
  const opener = plain(findUnclosedInline('The value $x^2 + '));
  assert.deepEqual(opener, { at: 10, length: 1, kind: '$' });
  assert.equal(findUnclosedInline('closed $x$ here'), null);
  assert.equal(findUnclosedInline('code `$x` is not math'), null);
  assert.equal(findUnclosedInline('escaped \\$5 is a dollar'), null);
  assert.equal(plain(findUnclosedInline('paren \\(a + ')).kind, '\\(');

  const plan = planStream('Done $a$.\n\nThe value $x^2 + ');
  assert.equal(plan.tail.text, 'The value \\$x^2 + ');
  const closed = planStream('Done $a$.\n\nThe value $x^2 + 1$ is');
  assert.equal(closed.tail.text, 'The value $x^2 + 1$ is');
  assert.equal(closed.tail.math, true);
});

test('previews an unclosed display formula from its complete lines', () => {
  const plan = plain(planStream('Solve:\n\n$$\n\\begin{aligned}\na &= b \\\\\nc &= \\frac{1}{2'));
  assert.deepEqual(plan.segments.map((s) => s.text), ['Solve:\n\n']);
  assert.equal(plan.tail, null, 'the open formula is not rendered as raw text');
  assert.equal(plan.pending, '$$\n\\begin{aligned}\na &= b\n\\end{aligned}\n$$');
  const none = planStream('Solve:\n\n$$\n\\sum_{i');
  assert.equal(none.pending, null);
  const inline = plain(planStream('Then $$x = 1'));
  assert.equal(inline.tail.text, 'Then \\$\\$x = 1', 'an unclosed inline $$ is escaped, not hidden');
});

test('auto-closes braces, \\left and environments', () => {
  assert.equal(closePartialFormula('\\frac{a}{b\n'), '\\frac{a}{b}');
  assert.equal(closePartialFormula('\\left( x\n'), '\\left( x \\right.');
  assert.equal(
    closePartialFormula('\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n'),
    '\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}',
  );
  assert.equal(closePartialFormula('x}\n'), null);
  assert.equal(closePartialFormula('no newline yet'), null);
});

test('install swaps the memo type and restores it', () => {
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    memo: (type) => ({ $$typeof: Symbol.for('react.memo'), type, compare: null }),
    useMemo: (fn) => fn(),
  };
  const original = function MarkdownText() {};
  const memo = { $$typeof: Symbol.for('react.memo'), type: original, compare: null };
  const dispose = install(memo, React);
  assert.notEqual(memo.type, original);

  const settled = memo.type({ text: 'x $a$', streaming: false, labels: {} });
  assert.equal(settled.props.streaming, false);
  assert.equal(settled.type.type, original);

  const live = memo.type({ text: 'One $a$.\n\nTwo $b$ and more', streaming: true, labels: {} });
  assert.equal(live.type, 'div');
  assert.equal(live.props.className, 'dsh-latex-stream');
  const blocks = live.children[0];
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].props.streaming, false);
  assert.equal(blocks[1].props.streaming, false, 'a math tail renders on the settled arm');

  const noMath = memo.type({ text: 'just prose streaming', streaming: true, labels: {} });
  assert.equal(noMath.props.streaming, true, 'non-math streams keep the original path');

  // A second install (HMR) wraps the original, not the wrapper.
  const dispose2 = install(memo, React);
  dispose();
  assert.notEqual(memo.type, original, 'stale disposer does not clobber the newer install');
  dispose2();
  assert.equal(memo.type, original);
});
