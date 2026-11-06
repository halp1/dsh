/**
 * Regression tests for the failure that let a Claude weekly window run from
 * 98% straight through 100% without the gate ever closing.
 *
 * What actually happened, reconstructed from the live endpoint:
 *
 * 1. Two Claude logins of the SAME subscription were stored, so every poll
 *    cycle spent two lookups to learn one number.
 * 2. The usage endpoint allows ~1 lookup/minute and rate-limits PROGRESSIVELY —
 *    each hit inside a closed window extends the next one. Measured: call #2
 *    ~0.5s after #1 returns 429 with `retry-after: 0`; after a six-call burst
 *    the endpoint still refused 65s later and only recovered at ~130s.
 * 3. The plugin also refreshed 5–15s after every completed turn, so on a busy
 *    session the endpoint was hit constantly and never left its lockout.
 * 4. Every lookup therefore failed, and "a failed lookup never pauses" — the
 *    rule that protects against pausing a healthy session — silently became
 *    "never pause at all". The gate stayed open while the real window filled.
 *
 * Each test below pins one link in that chain.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PauseGate } from '../src/gate.js';
import { UsagePoller, sameSubscription } from '../src/poller.js';
import { rateLimitSignal, resolveConfig } from '../src/index.js';

const quietLogger = { info() {}, warn() {}, debug() {}, error() {} };

/** A poller with counted, stubbed lookups. */
function makePoller({ store, usage, config = {}, logger = quietLogger }) {
  const gate = new PauseGate();
  const poller = new UsagePoller({ gate, config: resolveConfig(config), logger });
  const calls = [];
  poller.refreshAll = async function () {
    for (const provider of this.config.providers) {
      await this.refreshProvider(store, provider);
      this.checkStale(provider);
    }
  };
  poller.readUsage = async (provider, key) => {
    calls.push(`${provider}/${key}`);
    return usage(provider, key);
  };
  return { gate, poller, calls };
}

describe('regression: endpoint call budget', () => {
  it('spends only ONE lookup per cycle for two logins of one subscription', async () => {
    // Both logins report byte-identical windows: the same subscription.
    const identical = {
      supported: true,
      windows: [
        { kind: 'session', usedPercent: 20, resetsAt: 1_000 },
        { kind: 'weekly', usedPercent: 45, resetsAt: 2_000 },
      ],
    };
    const { calls, poller } = makePoller({
      store: {
        claude: {
          accounts: { 'token-abc': { accessToken: 'a' }, 'me@x.com': { accessToken: 'b' } },
        },
      },
      usage: async () => identical,
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();

    assert.equal(
      calls.length,
      1,
      `one cycle must cost one call against a ~1/min budget, spent ${calls.length}`,
    );
  });

  it('never exceeds one lookup per minute across repeated cycles', async () => {
    const { calls, poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' }, b: { accessToken: 'b' } } } },
      usage: async () => ({
        supported: true,
        windows: [{ kind: 'session', usedPercent: 10, resetsAt: 1_000 }],
      }),
      config: { providers: ['claude'] },
    });

    // Ten cycles back to back, as a busy session would have triggered.
    for (let i = 0; i < 10; i += 1) await poller.refreshAll();

    assert.equal(
      calls.length,
      1,
      `ten immediate cycles must not burst the endpoint, spent ${calls.length}`,
    );
  });

  it('rejects the poll intervals that caused the lockout', () => {
    // The original defaults: 120s/30s, with a 5s floor and a 5–15s post-turn
    // refresh. All of these are now refused at config time.
    assert.throws(() => resolveConfig({ pollIntervalMs: 5_000 }), /at least 60000/);
    assert.throws(() => resolveConfig({ pollIntervalMs: 30_000 }), /at least 60000/);
    assert.throws(() => resolveConfig({ pausedPollIntervalMs: 30_000 }), /at least 60000/);
  });

  it('defaults to a cadence the endpoint can actually serve', () => {
    const config = resolveConfig();
    assert.ok(config.pollIntervalMs >= 300_000, 'open-state polling must be conservative');
    assert.ok(config.pausedPollIntervalMs >= 60_000);
  });

  it('stops hitting the endpoint for the rest of a cycle once refused', async () => {
    const { calls, poller } = makePoller({
      store: {
        claude: {
          accounts: { a: { accessToken: 'a' }, b: { accessToken: 'b' }, c: { accessToken: 'c' } },
        },
      },
      usage: async () => undefined, // every lookup refused (429)
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();

    assert.equal(
      calls.length,
      1,
      'a 429 means the limiter is closed; asking again for each account extends the lockout',
    );
  });

  it('backs off for five minutes after a refusal, matching upstream', async () => {
    const { calls, poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' } } } },
      usage: async () => undefined,
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    await poller.refreshAll();
    assert.equal(calls.length, 1, 'must not retry inside the cooldown');

    // Four minutes later: still cooling down.
    poller.cooldownUntil.set('claude', Date.now() + 60_000);
    await poller.refreshAll();
    assert.equal(calls.length, 1);
  });
});

describe('regression: a second login must not suppress pausing forever', () => {
  it('converges to a pause within a couple of cycles with two logins', async () => {
    // The live setup: two Claude logins of ONE subscription, both over
    // threshold. Call spacing means cycle 1 reads only the first account, so
    // the decision is deferred; rotation must then read the second and pause.
    // An earlier fix deferred forever here, which is the original bug wearing
    // a different hat: quota exhausted, gate wide open.
    const { gate, poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' }, b: { accessToken: 'b' } } } },
      usage: async () => ({
        supported: true,
        windows: [{ kind: 'weekly', usedPercent: 99, resetsAt: 9_000 }],
      }),
      config: { providers: ['claude'], threshold: 98 },
    });

    await poller.refreshAll();
    poller.lastCallAt.set('claude', Date.now() - 61_000);
    await poller.refreshAll();

    assert.notEqual(
      gate.blockReason('claude'),
      undefined,
      'two logins of one subscription must not keep the gate open at 99%',
    );
  });

  it('rotates through accounts so none is left permanently unread', async () => {
    const { calls, poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' }, b: { accessToken: 'b' } } } },
      usage: async () => ({
        supported: true,
        windows: [{ kind: 'session', usedPercent: 10, resetsAt: 1_000 }],
      }),
      config: { providers: ['claude'] },
    });

    await poller.refreshAll();
    poller.lastCallAt.set('claude', Date.now() - 61_000);
    await poller.refreshAll();

    assert.deepEqual(calls, ['claude/a', 'claude/b'], 'the second cycle must read the other account');
  });
});

describe('regression: an unreadable account must not hold the gate open forever', () => {
  it('pauses on the accounts that answered once the grace period expires', async () => {
    // The live failure: one login answers and is over threshold, the other is
    // stuck behind the usage endpoint's throttle and never answers. Waiting for
    // certainty that will never arrive is how the gate stayed open through 100%.
    const { gate, poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' }, b: { accessToken: 'b' } } } },
      usage: async (_p, key) =>
        key === 'a'
          ? { supported: true, windows: [{ kind: 'weekly', usedPercent: 99, resetsAt: 9_000 }] }
          : undefined,
      config: { providers: ['claude'], threshold: 98 },
    });

    await poller.refreshAll();
    assert.equal(gate.blockReason('claude'), undefined, 'brief deference is correct');

    // The unread account still has not answered ten minutes on.
    poller.deferredSince.set('claude', Date.now() - 11 * 60_000);
    poller.lastCallAt.set('claude', Date.now() - 61_000);
    poller.cooldownUntil.clear();
    await poller.refreshAll();

    assert.notEqual(
      gate.blockReason('claude'),
      undefined,
      'past the grace period it must act on the readings it has',
    );
  });

  it('falls back to a cached reading when the rotation lands on a refusing account', async () => {
    // Rotation can start the cycle on the throttled account. Breaking out
    // without consulting the cache would discard a perfectly good reading for
    // the other account and blind the whole cycle.
    const { gate, poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' }, b: { accessToken: 'b' } } } },
      usage: async (_p, key) =>
        key === 'a'
          ? { supported: true, windows: [{ kind: 'weekly', usedPercent: 99, resetsAt: 9_000 }] }
          : undefined,
      config: { providers: ['claude'], threshold: 98 },
    });

    await poller.refreshAll(); // reads a, caches it; b refuses
    assert.ok(poller.readingCache.has('claude/a'), 'a good reading must be cached');

    poller.deferredSince.set('claude', Date.now() - 11 * 60_000);
    poller.lastCallAt.set('claude', Date.now() - 61_000);
    poller.cooldownUntil.clear();
    await poller.refreshAll(); // rotation starts on b, which refuses again

    assert.notEqual(
      gate.blockReason('claude'),
      undefined,
      "a refusal must not discard the other account's cached reading",
    );
  });

  it('warns when it stops waiting for an unanswered account', async () => {
    const warnings = [];
    const { poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' }, b: { accessToken: 'b' } } } },
      usage: async (_p, key) =>
        key === 'a'
          ? { supported: true, windows: [{ kind: 'weekly', usedPercent: 99, resetsAt: 9_000 }] }
          : undefined,
      config: { providers: ['claude'], threshold: 98 },
      logger: { ...quietLogger, warn: (m) => warnings.push(m) },
    });

    await poller.refreshAll();
    poller.deferredSince.set('claude', Date.now() - 11 * 60_000);
    poller.lastCallAt.set('claude', Date.now() - 61_000);
    poller.cooldownUntil.clear();
    await poller.refreshAll();

    assert.ok(
      warnings.some((m) => m.includes('not answered')),
      'the user must be told the decision was made on partial data',
    );
  });
});

describe('regression: subscription dedupe', () => {
  it('treats identical windows with identical resets as one subscription', () => {
    const a = {
      supported: true,
      windows: [{ kind: 'session', usedPercent: 20, resetsAt: 1_000 }],
    };
    const b = {
      supported: true,
      windows: [{ kind: 'session', usedPercent: 20, resetsAt: 1_000 }],
    };
    assert.equal(sameSubscription(a, b), true);
  });

  it('keeps distinct subscriptions separate when resets differ', () => {
    const a = {
      supported: true,
      windows: [{ kind: 'session', usedPercent: 20, resetsAt: 1_000 }],
    };
    const b = {
      supported: true,
      windows: [{ kind: 'session', usedPercent: 20, resetsAt: 2_000 }],
    };
    assert.equal(sameSubscription(a, b), false);
  });

  it('does not collapse two empty readings into one subscription', () => {
    const empty = { supported: true, windows: [] };
    assert.equal(sameSubscription(empty, empty), false);
  });
});

describe('regression: the gate must not go silently blind', () => {
  it('warns loudly once usage data is stale', async () => {
    const warnings = [];
    const logger = { ...quietLogger, warn: (m) => warnings.push(m) };

    const { poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' } } } },
      usage: async () => undefined,
      config: { providers: ['claude'] },
      logger,
    });

    // A good reading, then the endpoint stops answering for a long time.
    poller.lastGoodAt.set('claude', Date.now() - 20 * 60_000);
    await poller.refreshAll();

    const stale = warnings.find((m) => m.includes('STALE'));
    assert.ok(stale, `expected a stale warning, got: ${JSON.stringify(warnings)}`);
    assert.match(stale, /NOT being enforced/, 'the warning must say limits are unenforced');
  });

  it('warns only once rather than every cycle', async () => {
    const warnings = [];
    const logger = { ...quietLogger, warn: (m) => warnings.push(m) };
    const { poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' } } } },
      usage: async () => undefined,
      config: { providers: ['claude'] },
      logger,
    });

    poller.lastGoodAt.set('claude', Date.now() - 20 * 60_000);
    for (let i = 0; i < 5; i += 1) {
      poller.cooldownUntil.clear();
      poller.lastCallAt.clear();
      await poller.refreshAll();
    }
    assert.equal(warnings.filter((m) => m.includes('STALE')).length, 1);
  });

  it('clears the stale state once a reading succeeds again', async () => {
    let broken = true;
    const { poller } = makePoller({
      store: { claude: { accounts: { a: { accessToken: 'a' } } } },
      usage: async () =>
        broken
          ? undefined
          : { supported: true, windows: [{ kind: 'session', usedPercent: 4, resetsAt: 1 }] },
      config: { providers: ['claude'] },
    });

    poller.lastGoodAt.set('claude', Date.now() - 20 * 60_000);
    await poller.refreshAll();
    assert.ok(poller.staleWarned.has('claude'));

    broken = false;
    poller.cooldownUntil.clear();
    poller.lastCallAt.clear();
    await poller.refreshAll();
    assert.equal(poller.staleWarned.has('claude'), false);
  });
});

describe('regression: stream-level rate-limit backstop', () => {
  it('reads a RATE_LIMIT finish chunk as a closure signal', () => {
    const chunk = {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'RATE_LIMIT', message: 'rate limited', providerRetryAfterMs: 900_000 },
      },
    };
    assert.equal(rateLimitSignal(chunk), 900_000);
  });

  it('reads a bare 429 status even without the code', () => {
    const chunk = {
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'HTTP', message: 'nope', status: 429 } },
    };
    assert.equal(rateLimitSignal(chunk), 60_000, 'undisclosed reset holds briefly');
  });

  it('treats an exhausted quota as a closure', () => {
    const chunk = {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'QUOTA_EXCEEDED', message: 'usage_limit_reached' },
      },
    };
    assert.ok(rateLimitSignal(chunk) > 0);
  });

  it('ignores ordinary chunks and non-rate-limit failures', () => {
    assert.equal(rateLimitSignal({ type: 'text-delta', text: 'hi' }), undefined);
    assert.equal(rateLimitSignal({ type: 'finish', reason: { kind: 'stop' } }), undefined);
    assert.equal(
      rateLimitSignal({
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'TRANSPORT', message: 'dns' } },
      }),
      undefined,
    );
    assert.equal(
      rateLimitSignal({
        type: 'finish',
        reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'stopped' } },
      }),
      undefined,
      'a user abort is not a rate limit',
    );
  });

  it('closes the gate from a stream signal even with polling blind', () => {
    // This is the property whose absence let the window reach 100%: with every
    // usage lookup failing, the provider's own refusal must still close the gate.
    const gate = new PauseGate();
    const signal = rateLimitSignal({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'RATE_LIMIT', message: 'limit', providerRetryAfterMs: 300_000 },
      },
    });
    gate.pause('claude', {
      window: 'provider-reported limit',
      usedPercent: 100,
      resetsAt: Date.now() + signal,
    });
    assert.notEqual(gate.blockReason('claude'), undefined);
  });
});
