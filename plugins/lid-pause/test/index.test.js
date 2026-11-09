import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PauseController } from '../src/state.js';
import { installListeners, interruptible, resolveConfig, LID_PAUSED_CODE } from '../src/index.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const logger = { info() {}, warn() {}, debug() {} };

function setup(overrides = {}) {
  const config = resolveConfig({ resumeDelayMs: 0, probe: false, ...overrides });
  const gate = new PauseController({ config });
  const listeners = new Map();
  const options = new Map();
  const ctx = {
    on(name, fn, opts) {
      listeners.set(name, fn);
      options.set(name, opts);
    },
  };
  installListeners(ctx, { gate, config, logger, isAgentLoopRequest: (o) => o.sessionId !== undefined });
  return { gate, listeners, options };
}

async function collect(iterable) {
  const out = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

/** A model stream that emits one chunk, then blocks until released. */
function blockingStream() {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let returned = false;
  const iterable = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          i += 1;
          if (i === 1) return { done: false, value: { type: 'text-delta', index: 0, text: 'hi' } };
          if (i > 2) return { done: true, value: undefined };
          await gate;
          return { done: false, value: { type: 'finish', reason: { kind: 'stop' } } };
        },
        async return() {
          returned = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  return { iterable, release: () => release(), wasReturned: () => returned };
}

test('llm/stream holds a request while paused and sends it on resume', async () => {
  const { gate, listeners } = setup();
  gate.setLid(true);
  let sent = false;
  const stream = listeners.get('llm/stream')({ sessionId: 's' }, async function* () {
    sent = true;
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
  const result = collect(stream);
  await tick(10);
  assert.equal(sent, false);
  gate.setLid(false);
  const chunks = await result;
  assert.equal(sent, true);
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});

test('llm/stream cuts off an in-flight agent stream with exactly one LID_PAUSED finish', async () => {
  const { gate, listeners } = setup();
  const model = blockingStream();
  const result = collect(listeners.get('llm/stream')({ sessionId: 's' }, () => model.iterable));
  await tick(5);
  gate.setLid(true);
  const chunks = await result;
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].type, 'finish');
  assert.equal(chunks[1].reason.failure.code, LID_PAUSED_CODE);
  await tick(5);
  model.release();
  await tick(5);
  assert.equal(model.wasReturned(), true);
});

test('llm/stream leaves auxiliary streams (titles, compaction) alone when the lid closes mid-stream', async () => {
  const { gate, listeners } = setup();
  const model = blockingStream();
  const result = collect(listeners.get('llm/stream')({}, () => model.iterable));
  await tick(5);
  gate.setLid(true);
  model.release();
  const chunks = await result;
  assert.equal(chunks.at(-1).reason.kind, 'stop');
});

test('interruptible passes a completed stream through untouched', async () => {
  const controller = new AbortController();
  async function* source() {
    yield { type: 'text-delta', text: 'a' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
  const chunks = await collect(interruptible(source(), controller.signal));
  assert.deepEqual(chunks.map((c) => c.type), ['text-delta', 'finish']);
});

const requestErrorCases = [
  { name: 'LID_PAUSED waits for resume then retries', code: LID_PAUSED_CODE, paused: true, expect: 'retry' },
  { name: 'TRANSPORT while paused is held and retried', code: 'TRANSPORT', paused: true, expect: 'retry' },
  { name: 'TRANSPORT right after wake is retried', code: 'TRANSPORT', wake: true, expect: 'retry' },
  { name: 'TRANSPORT in normal operation delegates', code: 'TRANSPORT', expect: 'next' },
  { name: 'AUTH after wake delegates', code: 'AUTH', wake: true, expect: 'next' },
];

for (const c of requestErrorCases) {
  test(`agent/request-error: ${c.name}`, async () => {
    const { gate, listeners, options } = setup();
    assert.equal(options.get('agent/request-error')?.prepend, true);
    if (c.wake) gate.setPower('did-wake');
    if (c.paused) gate.setLid(true);
    const pending = listeners.get('agent/request-error')(
      { failure: { code: c.code, message: 'x' }, signal: new AbortController().signal },
      async () => 'next',
    );
    if (c.paused) {
      await tick(5);
      gate.setLid(false);
    }
    const result = await pending;
    assert.deepEqual(result, c.expect === 'retry' ? { kind: 'retry' } : 'next');
  });
}

test('agent/request-error stops waiting when the user cancels', async () => {
  const { gate, listeners } = setup();
  gate.setLid(true);
  const controller = new AbortController();
  const pending = listeners.get('agent/request-error')(
    { failure: { code: LID_PAUSED_CODE, message: 'x' }, signal: controller.signal },
    async () => 'next',
  );
  controller.abort(new Error('stop'));
  await assert.rejects(pending, /stop/);
});

test('tools/execute holds new dispatches and reports abort as not dispatched', async () => {
  const { gate, listeners } = setup();
  gate.setLid(true);
  let ran = 0;
  const next = async () => {
    ran += 1;
    return { content: [] };
  };
  const held = listeners.get('tools/execute')({ signal: new AbortController().signal }, next);
  const controller = new AbortController();
  const cancelled = listeners.get('tools/execute')({ signal: controller.signal }, next);
  controller.abort();
  const aborted = await cancelled;
  assert.equal(aborted.isError, true);
  assert.equal(aborted.error.info.code, 'ABORTED_BEFORE_DISPATCH');
  await tick(5);
  assert.equal(ran, 0);
  gate.setLid(false);
  await held;
  assert.equal(ran, 1);
});

test('resolveConfig rejects invalid values', () => {
  for (const bad of [
    { resumeDelayMs: -1 },
    { enabled: 'yes' },
    { probe: { port: 0 } },
    { probe: { host: '' } },
    { pauseOnLidClose: false, pauseOnSleep: false },
  ]) {
    assert.throws(() => resolveConfig(bad), /lid-pause/);
  }
});
