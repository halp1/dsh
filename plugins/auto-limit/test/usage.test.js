/**
 * Tests for usage parsing and the auth-store reader.
 *
 * These pin the payload shapes this plugin re-implements from
 * dsh-plugin-subscriptions. If an upstream provider changes a field name, the
 * failure should surface here rather than as a session that silently never
 * pauses.
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { accountsOf, describeWindow, fetchClaudeUsage, fetchCodexUsage } from '../src/usage.js';

/** Build a fetch stub returning one JSON payload. */
function stubFetch(payload, { ok = true, status = 200 } = {}) {
  return mock.fn(async () => ({
    ok,
    status,
    json: async () => payload,
  }));
}

/** Run a block with `globalThis.fetch` replaced. */
async function withFetch(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe('accountsOf', () => {
  it('reads the multi-account shape with the default account first', () => {
    const store = {
      claude: {
        default: 'second',
        accounts: {
          first: { accessToken: 'a' },
          second: { accessToken: 'b' },
        },
      },
    };
    const accounts = accountsOf(store, 'claude');
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].key, 'second');
  });

  it('migrates the legacy flat single-account shape', () => {
    const store = { claude: { accessToken: 'a', emailAddress: 'me@example.com' } };
    const accounts = accountsOf(store, 'claude');
    assert.deepEqual(
      accounts.map((entry) => entry.key),
      ['me@example.com'],
    );
  });

  it('returns nothing for a logged-out or absent provider', () => {
    assert.deepEqual(accountsOf({}, 'codex'), []);
    assert.deepEqual(accountsOf({ codex: null }, 'codex'), []);
    assert.deepEqual(accountsOf(undefined, 'codex'), []);
  });
});

describe('fetchClaudeUsage', () => {
  it('prefers the modern limits array and maps every window kind', async () => {
    const resets = '2026-01-01T00:00:00Z';
    const stub = stubFetch({
      limits: [
        { kind: 'session', percent: 42, resets_at: resets },
        { kind: 'weekly_all', percent: 71, resets_at: resets },
        { kind: 'weekly_scoped', percent: 99, scope: { model: { display_name: 'Opus' } } },
        { kind: 'monthly', percent: 12 },
      ],
    });

    const usage = await withFetch(stub, () => fetchClaudeUsage({ accessToken: 't' }));

    assert.equal(usage.supported, true);
    assert.deepEqual(
      usage.windows.map((w) => w.kind),
      ['session', 'weekly', 'weekly', 'monthly'],
    );
    assert.equal(usage.windows[2].scope, 'Opus');
    assert.equal(usage.windows[0].resetsAt, Date.parse(resets));
  });

  it('falls back to the legacy flat buckets', async () => {
    const stub = stubFetch({
      five_hour: { utilization: 55, resets_at: '2026-01-01T00:00:00Z' },
      seven_day: { utilization: 80 },
      seven_day_opus: { utilization: 99 },
    });

    const usage = await withFetch(stub, () => fetchClaudeUsage({ accessToken: 't' }));

    assert.deepEqual(
      usage.windows.map((w) => [w.kind, w.usedPercent]),
      [
        ['session', 55],
        ['weekly', 80],
        ['weekly', 99],
      ],
    );
    assert.equal(usage.windows[2].scope, 'Opus');
  });

  it('sends the OAuth beta header the endpoint requires', async () => {
    const stub = stubFetch({ limits: [] });
    await withFetch(stub, () => fetchClaudeUsage({ accessToken: 'secret-token' }));

    const [, init] = stub.mock.calls[0].arguments;
    assert.equal(init.headers.authorization, 'Bearer secret-token');
    assert.equal(init.headers['anthropic-beta'], 'oauth-2025-04-20');
  });

  it('throws with the status when the endpoint refuses', async () => {
    const stub = stubFetch({}, { ok: false, status: 401 });
    await withFetch(stub, async () => {
      await assert.rejects(fetchClaudeUsage({ accessToken: 't' }), (error) => {
        assert.equal(error.status, 401);
        return true;
      });
    });
  });
});

describe('fetchCodexUsage', () => {
  it('classifies windows by reported duration, not slot position', async () => {
    const stub = stubFetch({
      plan_type: 'pro',
      rate_limit: {
        // The backend has been seen putting the weekly lane in the primary slot.
        primary_window: { used_percent: 64, limit_window_seconds: 10080 * 60 },
        secondary_window: { used_percent: 21, limit_window_seconds: 300 * 60 },
      },
    });

    const usage = await withFetch(stub, () => fetchCodexUsage({ accessToken: 't' }));

    assert.equal(usage.plan, 'pro');
    assert.deepEqual(
      usage.windows.map((w) => w.kind),
      ['weekly', 'session'],
    );
  });

  it('recognizes a monthly lane', async () => {
    const stub = stubFetch({
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 300 * 60 },
        monthly_window: { used_percent: 98.4, limit_window_seconds: 30 * 24 * 60 * 60 },
      },
    });

    const usage = await withFetch(stub, () => fetchCodexUsage({ accessToken: 't' }));
    const monthly = usage.windows.find((w) => w.kind === 'monthly');
    assert.equal(monthly?.usedPercent, 98.4);
  });

  it('derives resetsAt from reset_after_seconds when no absolute stamp is sent', async () => {
    const stub = stubFetch({
      rate_limit: {
        primary_window: {
          used_percent: 99,
          limit_window_seconds: 300 * 60,
          reset_after_seconds: 600,
        },
      },
    });

    const before = Date.now();
    const usage = await withFetch(stub, () => fetchCodexUsage({ accessToken: 't' }));
    const resetsAt = usage.windows[0].resetsAt;

    assert.ok(resetsAt >= before + 600_000);
    assert.ok(resetsAt <= Date.now() + 600_000);
  });

  it('converts an absolute reset_at from seconds to milliseconds', async () => {
    const stub = stubFetch({
      rate_limit: {
        primary_window: { used_percent: 99, reset_at: 1_800_000_000 },
      },
    });
    const usage = await withFetch(stub, () => fetchCodexUsage({ accessToken: 't' }));
    assert.equal(usage.windows[0].resetsAt, 1_800_000_000_000);
  });
});

describe('describeWindow', () => {
  it('names each window kind readably', () => {
    assert.equal(describeWindow({ kind: 'session' }), '5-hour');
    assert.equal(describeWindow({ kind: 'weekly' }), 'weekly');
    assert.equal(describeWindow({ kind: 'monthly' }), 'monthly');
    assert.equal(describeWindow({ kind: 'weekly', scope: 'Opus' }), 'weekly (Opus)');
  });
});
