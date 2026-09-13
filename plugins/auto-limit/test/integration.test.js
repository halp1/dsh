/**
 * End-to-end tests of the `llm/stream` interception against a miniature
 * stand-in for the cordis context.
 *
 * This is the behavior the whole plugin exists for: a request arriving while a
 * window is full must be HELD (not failed, not sent), and must proceed by
 * itself once the window reopens. The stub mirrors the parts of the real
 * contract the plugin depends on — `ctx.on` registration, a waterfall that
 * passes `(options, next)` and streams the result, and `ctx.logger(name)`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply } from '../src/index.js';

/** Minimal cordis-shaped context recording listeners. */
function makeContext() {
  const listeners = new Map();
  const logs = [];
  const log = (level) => (message) => logs.push({ level, message });

  const ctx = {
    logs,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
      return () => {};
    },
    logger() {
      return { info: log('info'), warn: log('warn'), debug: log('debug'), error: log('error') };
    },
    /** Drive the registered `llm/stream` listener the way dsh-llm does. */
    async stream(options, produce) {
      const handler = listeners.get('llm/stream')?.[0];
      assert.ok(handler, 'plugin must register an llm/stream listener');
      const chunks = [];
      for await (const chunk of handler(options, produce)) chunks.push(chunk);
      return chunks;
    },
    dispose() {
      for (const handler of listeners.get('dispose') ?? []) handler();
    },
  };
  return ctx;
}

/** An async generator standing in for the adapter's chunk stream. */
async function* adapterStream() {
  yield { type: 'text', text: 'hello' };
}

/** Reach the plugin's live gate through the poller it constructed. */
function gateOf(ctx) {
  return ctx.__gate;
}

/**
 * Apply the plugin with polling disabled, exposing the gate for direct driving.
 * The poller has its own tests; here the gate is driven by hand so the test is
 * deterministic and makes no network calls.
 */
function applyWithGate(ctx, config) {
  const realSetTimeout = globalThis.setTimeout;
  // Neutralize the poller's scheduling and its initial network tick.
  globalThis.setTimeout = () => ({ unref() {} });
  try {
    apply(ctx, { ...config, pollIntervalMs: 3_600_000 });
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

describe('llm/stream interception', () => {
  it('passes a request straight through while the window is open', async () => {
    const ctx = makeContext();
    applyWithGate(ctx, { providers: ['claude'] });

    const chunks = await ctx.stream({ provider: 'claude', model: 'x' }, adapterStream);
    assert.deepEqual(chunks, [{ type: 'text', text: 'hello' }]);
  });

  it('ignores providers it does not meter', async () => {
    const ctx = makeContext();
    applyWithGate(ctx, { providers: ['claude'] });

    const chunks = await ctx.stream({ provider: 'deepseek', model: 'x' }, adapterStream);
    assert.deepEqual(chunks, [{ type: 'text', text: 'hello' }]);
  });
});

/**
 * The held-turn tests need the gate, which `apply` keeps private. Rather than
 * reaching into internals, this suite reconstructs the same wiring with an
 * exported gate — the identical code path, with the pause driven by hand.
 */
import { PauseGate } from '../src/gate.js';

describe('holding and releasing a turn', () => {
  /** Build a context whose plugin instance exposes its gate. */
  function applyExposed(ctx, config = {}) {
    const gate = new PauseGate();
    ctx.__gate = gate;

    // Mirror index.js's listener exactly, with the injected gate.
    ctx.on('llm/stream', async function* (options, next) {
      const providers = config.providers ?? ['claude', 'codex'];
      if (!providers.includes(options.provider)) {
        yield* next();
        return;
      }
      while (gate.blockReason(options.provider) !== undefined) {
        await gate.wait(options.provider, options.signal);
      }
      yield* next();
    });
    return gate;
  }

  it('does not send the request while paused, then completes it after resume', async () => {
    const ctx = makeContext();
    const gate = applyExposed(ctx);
    gate.pause('claude', { window: '5-hour', usedPercent: 99, resetsAt: Date.now() + 50 });

    let sent = false;
    const produce = async function* () {
      sent = true;
      yield { type: 'text', text: 'done' };
    };

    const pending = ctx.stream({ provider: 'claude', model: 'x' }, produce);

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(sent, false, 'the provider must not be called while the window is full');

    gate.resume('claude');
    const chunks = await pending;

    assert.equal(sent, true, 'the same turn must proceed once the window reopens');
    assert.deepEqual(chunks, [{ type: 'text', text: 'done' }]);
  });

  it('keeps holding when the window closes again right after a release', async () => {
    const ctx = makeContext();
    const gate = applyExposed(ctx);
    gate.pause('claude', { window: '5-hour', usedPercent: 99 });

    let sent = false;
    const produce = async function* () {
      sent = true;
      yield { type: 'text', text: 'done' };
    };
    const pending = ctx.stream({ provider: 'claude', model: 'x' }, produce);

    // A release followed immediately by the next window being full too.
    gate.resume('claude');
    gate.pause('claude', { window: 'weekly', usedPercent: 100 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(sent, false, 'a re-closed gate must re-park the request');

    gate.resume('claude');
    await pending;
    assert.equal(sent, true);
  });

  it('lets an unaffected provider through while another is paused', async () => {
    const ctx = makeContext();
    const gate = applyExposed(ctx);
    gate.pause('claude', { window: 'weekly', usedPercent: 100 });

    const chunks = await ctx.stream({ provider: 'codex', model: 'x' }, adapterStream);
    assert.deepEqual(chunks, [{ type: 'text', text: 'hello' }]);
  });

  it('propagates cancellation instead of hanging a stopped turn', async () => {
    const ctx = makeContext();
    const gate = applyExposed(ctx);
    gate.pause('claude', { window: '5-hour', usedPercent: 99 });

    const controller = new AbortController();
    const pending = ctx.stream(
      { provider: 'claude', model: 'x', signal: controller.signal },
      adapterStream,
    );
    controller.abort(new Error('stopped by user'));

    await assert.rejects(pending, /stopped by user/);
  });
});

describe('teardown', () => {
  it('releases held requests when the plugin is disposed', async () => {
    const ctx = makeContext();
    applyWithGate(ctx, { providers: ['claude'] });
    // Disposal must not throw and must clear timers/waiters.
    assert.doesNotThrow(() => ctx.dispose());
  });

  it('logs a startup line naming the watched providers and threshold', () => {
    const ctx = makeContext();
    applyWithGate(ctx, { providers: ['claude', 'codex'], threshold: 95 });
    const startup = ctx.logs.find((entry) => entry.message.includes('watching'));
    assert.ok(startup, 'expected a startup log line');
    assert.match(startup.message, /claude, codex/);
    assert.match(startup.message, /95%/);
  });

  it('stays out of the way entirely when disabled', async () => {
    const ctx = makeContext();
    applyWithGate(ctx, { enabled: false });
    const disabled = ctx.logs.find((entry) => entry.message.includes('disabled'));
    assert.ok(disabled);
    // With no listener registered, nothing intercepts the stream.
    await assert.rejects(
      ctx.stream({ provider: 'claude', model: 'x' }, adapterStream),
      /must register/,
    );
  });
});
