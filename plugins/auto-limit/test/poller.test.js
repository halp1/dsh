/**
 * Tests for the poller's pause/resume decisions.
 *
 * The poller is where a wrong call is most costly, so the safety properties are
 * pinned explicitly: a failed lookup must never pause, a multi-account provider
 * must not pause while one account still has quota, and a logout must not leave
 * a stale pause behind.
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { PauseGate } from '../src/gate.js';
import { UsagePoller } from '../src/poller.js';
import { resolveConfig } from '../src/index.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

/**
 * Build a poller whose network reads are stubbed.
 * @param options.store - the auth store to serve.
 * @param options.usage - `(provider, accountKey) => usage | throws`.
 */
function makePoller({ store, usage, config = {} }) {
  const gate = new PauseGate();
  const poller = new UsagePoller({
    gate,
    config: resolveConfig(config),
    logger: silentLogger,
  });

  poller.refreshAll = async function () {
    const providers = this.config.providers;
    await Promise.all(providers.map((provider) => this.refreshProvider(store, provider)));
  };
  poller.readUsage = mock.fn(async (provider, key) => {
    try {
      return await usage(provider, key);
    } catch {
      return undefined;
    }
  });

  // Cycles in real life are spaced minutes apart by the scheduler. Tests drive
  // refreshAll() back to back, so advance the call clock to represent that.
  poller.advanceClock = () => {
    for (const provider of poller.config.providers) {
      poller.lastCallAt.set(provider, Date.now() - 61_000);
    }
  };
  return { gate, poller };
}

describe('UsagePoller decisions', () => {
  it('pauses when the only account crosses the threshold', async () => {
    const { gate, poller } = makePoller({
      store: { claude: { accounts: { me: { accessToken: 't' } } } },
      usage: async () => ({
        supported: true,
        windows: [{ kind: 'session', usedPercent: 98.3, resetsAt: 4_000 }],
      }),
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();

    const reason = gate.blockReason('claude');
    assert.equal(reason?.window, '5-hour');
    assert.equal(reason?.resetsAt, 4_000);
  });

  it('does not pause below the threshold', async () => {
    const { gate, poller } = makePoller({
      store: { claude: { accounts: { me: { accessToken: 't' } } } },
      usage: async () => ({
        supported: true,
        windows: [{ kind: 'weekly', usedPercent: 97.99 }],
      }),
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    assert.equal(gate.blockReason('claude'), undefined);
  });

  it('stays open while a distinct subscription still has quota', async () => {
    const { gate, poller } = makePoller({
      store: {
        claude: { accounts: { full: { accessToken: 'a' }, fresh: { accessToken: 'b' } } },
      },
      // Distinct subscriptions: different reset instants.
      usage: async (_provider, key) => ({
        supported: true,
        windows: [
          {
            kind: 'session',
            usedPercent: key === 'full' ? 100 : 5,
            resetsAt: key === 'full' ? 1_000 : 2_000,
          },
        ],
      }),
      config: { providers: ['claude'] },
    });

    // Call spacing means the second account is read on a later cycle; the
    // gate must not pause on partial information before then.
    await poller.refreshAll();
    poller.advanceClock();
    await poller.refreshAll();
    assert.equal(gate.blockReason('claude'), undefined, 'pooled quota must keep it open');
  });

  it('pauses on the soonest reset once every subscription is full', async () => {
    const { gate, poller } = makePoller({
      store: {
        claude: { accounts: { a: { accessToken: 'a' }, b: { accessToken: 'b' } } },
      },
      usage: async (_provider, key) => ({
        supported: true,
        windows: [
          { kind: 'session', usedPercent: 99, resetsAt: key === 'a' ? 9_000 : 6_000 },
        ],
      }),
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    // Second cycle a minute later: the call budget has replenished, so the
    // remaining subscription is read and the pause decision completes.
    poller.advanceClock();
    await poller.refreshAll();
    assert.equal(gate.blockReason('claude')?.resetsAt, 6_000);
  });

  it('resumes once usage drops back below the threshold', async () => {
    let full = true;
    const { gate, poller } = makePoller({
      store: { claude: { accounts: { me: { accessToken: 't' } } } },
      usage: async () => ({
        supported: true,
        windows: [{ kind: 'session', usedPercent: full ? 99 : 3 }],
      }),
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    assert.notEqual(gate.blockReason('claude'), undefined);

    full = false; // the window reset
    poller.advanceClock();
    await poller.refreshAll();
    assert.equal(gate.blockReason('claude'), undefined);
  });

  it('never pauses when the usage lookup fails', async () => {
    const { gate, poller } = makePoller({
      store: { claude: { accounts: { me: { accessToken: 't' } } } },
      usage: async () => {
        throw new Error('endpoint down');
      },
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    assert.equal(gate.blockReason('claude'), undefined, 'silence is not evidence of a full window');
  });

  it('holds an existing pause when lookups start failing', async () => {
    let broken = false;
    const { gate, poller } = makePoller({
      store: { claude: { accounts: { me: { accessToken: 't' } } } },
      usage: async () => {
        if (broken) throw new Error('endpoint down');
        return { supported: true, windows: [{ kind: 'session', usedPercent: 99 }] };
      },
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    assert.notEqual(gate.blockReason('claude'), undefined);

    broken = true;
    poller.advanceClock();
    await poller.refreshAll();
    assert.notEqual(
      gate.blockReason('claude'),
      undefined,
      'a failed re-check must not release into a possibly-closed window',
    );
  });

  it('clears a stale pause when the account is logged out', async () => {
    const store = { claude: { accounts: { me: { accessToken: 't' } } } };
    const { gate, poller } = makePoller({
      store,
      usage: async () => ({
        supported: true,
        windows: [{ kind: 'session', usedPercent: 100 }],
      }),
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    assert.notEqual(gate.blockReason('claude'), undefined);

    delete store.claude;
    poller.advanceClock();
    await poller.refreshAll();
    assert.equal(gate.blockReason('claude'), undefined);
  });

  it('backs off after a failure instead of hammering the endpoint', async () => {
    const { poller } = makePoller({
      store: { claude: { accounts: { me: { accessToken: 't' } } } },
      usage: async () => {
        throw new Error('429 from the usage endpoint itself');
      },
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    assert.equal(poller.readUsage.mock.callCount(), 1);

    poller.advanceClock();
    await poller.refreshAll(); // inside the cooldown
    assert.equal(poller.readUsage.mock.callCount(), 1, 'must not retry during cooldown');
  });

  it('only polls configured providers', async () => {
    const seen = [];
    const { poller } = makePoller({
      store: {
        claude: { accounts: { a: { accessToken: 't' } } },
        codex: { accounts: { b: { accessToken: 't' } } },
      },
      usage: async (provider) => {
        seen.push(provider);
        return { supported: true, windows: [] };
      },
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    assert.deepEqual(seen, ['claude']);
  });
});

describe('poll cadence', () => {
  it('uses the normal interval while everything is open', () => {
    const { poller } = makePoller({
      store: {},
      usage: async () => ({ supported: true, windows: [] }),
      config: { pollIntervalMs: 120_000 },
    });
    assert.equal(poller.nextDelayMs(), 120_000);
  });

  it('polls sooner when a disclosed reset is near', () => {
    const { gate, poller } = makePoller({
      store: {},
      usage: async () => ({ supported: true, windows: [] }),
      config: { pausedPollIntervalMs: 120_000 },
    });
    gate.pause('claude', {
      window: '5-hour',
      usedPercent: 99,
      resetsAt: Date.now() + 80_000,
    });
    const delay = poller.nextDelayMs();
    // Sooner than the paused interval, but never below the 60s call floor.
    assert.ok(delay >= 60_000 && delay <= 85_000, `expected a near-reset delay, got ${delay}`);
  });

  it('falls back to the paused interval when no reset was disclosed', () => {
    const { gate, poller } = makePoller({
      store: {},
      usage: async () => ({ supported: true, windows: [] }),
      config: { pausedPollIntervalMs: 120_000 },
    });
    gate.pause('claude', { window: 'weekly', usedPercent: 99 });
    assert.equal(poller.nextDelayMs(), 120_000);
  });
});

describe('resolveConfig', () => {
  it('defaults to 98% across both metered providers', () => {
    const config = resolveConfig();
    assert.equal(config.threshold, 98);
    assert.ok(config.pollIntervalMs >= 60_000, 'must respect the endpoint budget');
    assert.deepEqual([...config.providers], ['claude', 'codex']);
    assert.equal(config.enabled, true);
    assert.equal(config.maxHoldMs, 0, 'unbounded hold by default');
  });

  it('rejects a nonsensical threshold', () => {
    assert.throws(() => resolveConfig({ threshold: 0 }), /within/);
    assert.throws(() => resolveConfig({ threshold: 101 }), /within/);
    assert.throws(() => resolveConfig({ threshold: 'high' }), /must be a number/);
  });

  it('rejects an unknown provider rather than silently ignoring it', () => {
    assert.throws(() => resolveConfig({ providers: ['gemini'] }), /unknown provider/);
  });

  it('refuses a poll interval that would hammer the endpoint', () => {
    assert.throws(() => resolveConfig({ pollIntervalMs: 100 }), /at least 60000/);
    // 5s used to be allowed and is exactly what wedged the endpoint into a
    // permanent 429; it must now be rejected.
    assert.throws(() => resolveConfig({ pollIntervalMs: 5_000 }), /at least 60000/);
  });
});
