/**
 * Tests for burn-rate forecasts and the poller's use of them.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { AccountHistory, WindowHistory, poolClosesAt, reachesAt } from '../src/forecast.js';
import { PauseGate } from '../src/gate.js';
import { UsagePoller } from '../src/poller.js';
import { resolveConfig } from '../src/index.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 27, 0, 0, 0);
const at = (hours) => T0 + hours * HOUR;

/** Readings every two minutes from `from` to `to` hours, as `percent(hours)`. */
function history(kind, from, to, resetsAt, percent, step = 2 / 60) {
  const h = new WindowHistory(kind);
  for (let x = from; x <= to + 1e-9; x += step) {
    h.record({ usedPercent: percent(x), resetsAt: typeof resetsAt === 'function' ? resetsAt(x) : resetsAt }, at(x));
  }
  return h;
}

describe('WindowHistory forecasts', () => {
  // A 5-hour window from hour 0 to hour 5 unless stated.
  const cases = [
    {
      name: 'steep burn closes before the reset',
      history: history('session', 1, 2, at(5), (x) => 20 + 30 * (x - 1)),
      now: 2,
      rate: [29, 31],
      closesAt: [3.55, 3.7],
    },
    {
      name: 'a pace that lands after the reset stays open',
      history: history('session', 1, 2, at(5), (x) => 10 * x),
      now: 2,
      rate: [9.5, 10.5],
      closesAt: null,
    },
    {
      name: 'flat usage has no pace',
      history: history('session', 1, 3, at(5), () => 40),
      now: 3,
      rate: [0, 0.5],
      closesAt: null,
    },
    {
      name: 'busy then idle settles toward zero',
      history: history('session', 0.5, 4, at(5), (x) => (x < 1.5 ? 60 * (x - 0.5) : 60)),
      now: 4,
      rate: [0, 8],
      closesAt: null,
    },
    {
      name: 'a reset mid-history keeps only the new period',
      history: history('session', 3, 6, (x) => (x < 5 ? at(5) : at(10)), (x) => (x < 5 ? 80 + 5 * (x - 3) : 10 * (x - 5))),
      now: 6,
      rate: [8, 12],
      closesAt: null,
    },
    {
      name: 'a relative reset that jitters between polls is the same period',
      history: history('session', 1, 2, (x) => at(5) + ((x * 997) % 7) * 1000, (x) => 30 * x),
      now: 2,
      rate: [28, 32],
      closesAt: [3.2, 3.35],
    },
    {
      name: 'just after a reset there is too little history',
      history: history('session', 3, 5.1, (x) => (x < 5 ? at(5) : at(10)), (x) => (x < 5 ? 90 : 3)),
      now: 5.1,
      forecast: false,
    },
    {
      name: 'readings a few minutes apart are not a forecast',
      history: history('session', 3, 3.1, at(5), (x) => 50 + 100 * (x - 3)),
      now: 3.1,
      forecast: false,
    },
    {
      name: 'a window that has reset forecasts nothing',
      history: history('session', 1, 2, at(5), (x) => 30 * x),
      now: 5.5,
      forecast: false,
    },
    {
      name: 'sparse readings still forecast',
      history: history('session', 1, 2, at(5), (x) => 25 * x, 0.5),
      now: 2,
      rate: [22, 28],
      closesAt: [3.8, 4.1],
    },
    {
      name: 'a weekly window at a slow pace stays open',
      history: history('weekly', 24, 48, at(168), (x) => 0.4 * x, 0.5),
      now: 48,
      rate: [0.3, 0.5],
      closesAt: null,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const forecast = c.history.forecast(at(c.now));
      if (c.forecast === false) {
        assert.equal(forecast, undefined);
        return;
      }
      assert.ok(forecast, 'expected a forecast');
      const [lo, hi] = c.rate;
      assert.ok(forecast.ratePerHour >= lo && forecast.ratePerHour <= hi, `rate ${forecast.ratePerHour}`);
      const closes = reachesAt(forecast, 98);
      const before = closes !== undefined && closes < forecast.resetsAt ? (closes - T0) / HOUR : null;
      if (c.closesAt === null) {
        assert.equal(before, null, `closes at ${before}h`);
      } else {
        assert.ok(before >= c.closesAt[0] && before <= c.closesAt[1], `closes at ${before}h`);
      }
    });
  }

  it('lets a reading taken after the clock jumped back replace later-stamped ones', () => {
    const h = new WindowHistory('session');
    h.record({ usedPercent: 10, resetsAt: at(5) }, at(1));
    h.record({ usedPercent: 20, resetsAt: at(5) }, at(2));
    h.record({ usedPercent: 22, resetsAt: at(5) }, at(1.5));
    assert.deepEqual(h.samples.map((s) => s.usedPercent), [10, 22]);
  });

  it('ignores readings from before the window began', () => {
    const h = new WindowHistory('session');
    h.record({ usedPercent: 5, resetsAt: at(5) }, at(-0.5));
    assert.equal(h.samples.length, 0);
  });
});

describe('poolClosesAt', () => {
  const closing = (hours) => ({ at: at(hours) });
  const cases = [
    { name: 'a lone subscription closes when it does', closings: [closing(3)], expected: 3 },
    { name: 'a pool closes when its last subscription does', closings: [closing(3), closing(4)], expected: 4 },
    { name: 'one subscription not on pace keeps the pool open', closings: [closing(3), undefined], expected: null },
    { name: 'no subscriptions, no forecast', closings: [], expected: null },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const result = poolClosesAt(c.closings);
      assert.equal(result === undefined ? null : (result.at - T0) / HOUR, c.expected);
    });
  }
});

describe('AccountHistory.closesAt', () => {
  it('keeps Opus and all-model weekly lanes apart and picks the first to close', () => {
    const account = new AccountHistory();
    for (let x = 24; x <= 48; x += 0.5) {
      account.record(
        {
          supported: true,
          windows: [
            { kind: 'weekly', usedPercent: 0.2 * x, resetsAt: at(168) },
            { kind: 'weekly', scope: 'Opus', usedPercent: 1.5 * x, resetsAt: at(168) },
          ],
        },
        at(x),
      );
    }
    const latest = {
      supported: true,
      windows: [
        { kind: 'weekly', usedPercent: 9.6, resetsAt: at(168) },
        { kind: 'weekly', scope: 'Opus', usedPercent: 72, resetsAt: at(168) },
      ],
    };
    const closing = account.closesAt(latest, 98, at(48));
    assert.equal(closing?.window.scope, 'Opus');
    assert.ok(Math.abs((closing.at - T0) / HOUR - 65.3) < 1, `closes at ${(closing.at - T0) / HOUR}h`);
  });
});

describe('poller forecasts', () => {
  afterEach(() => mock.timers.reset());

  /** A poller driven on a mocked clock, reading `usage(key, hours)`. */
  function makePoller({ accounts, usage, config }) {
    mock.timers.enable({ apis: ['Date'], now: T0 });
    const logs = [];
    const gate = new PauseGate();
    const poller = new UsagePoller({
      gate,
      config: resolveConfig({ providers: ['claude'], ...config }),
      logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), debug() {} },
    });
    const store = { claude: { accounts: Object.fromEntries(accounts.map((key) => [key, { accessToken: key }])) } };
    let calls = 0;
    poller.readUsage = async (_provider, key) => {
      calls += 1;
      return usage(key, (Date.now() - T0) / HOUR);
    };
    /** Advance to `hours` and run one cycle. */
    const cycle = async (hours) => {
      mock.timers.setTime(at(hours));
      await poller.refreshProvider(store, 'claude');
    };
    return { gate, poller, logs, cycle, calls: () => calls };
  }

  const session = (percent, reset = at(5)) => ({
    supported: true,
    windows: [{ kind: 'session', usedPercent: percent, resetsAt: reset }],
  });

  it('polls when the threshold is due instead of a full interval later', async () => {
    const { poller, logs, cycle } = makePoller({
      accounts: ['me'],
      usage: (_key, h) => session(Math.min(100, 30 * h)),
      config: { pollIntervalMs: 3 * HOUR },
    });
    for (let h = 0.5; h <= 2.01; h += 0.25) await cycle(h);

    // 60% at hour 2 rising 30%/h reaches 98% around hour 3.27, before the 5h reset.
    const delay = poller.nextDelayMs();
    assert.ok(delay < 3 * HOUR, `delay ${delay}`);
    assert.ok(Math.abs(Date.now() + delay - at(3.27)) < 10 * 60_000, `polls at ${(Date.now() + delay - T0) / HOUR}h`);
    assert.ok(logs.some((m) => m.includes('on pace to reach 98%')), JSON.stringify(logs));
  });

  it('never brings a poll closer than two minutes', async () => {
    const { poller, cycle } = makePoller({
      accounts: ['me'],
      usage: (_key, h) => session(Math.min(97, 30 * h + 37)),
      config: { pollIntervalMs: 30 * 60_000 },
    });
    for (let h = 0.5; h <= 2.01; h += 0.25) await cycle(h);
    assert.ok(poller.nextDelayMs() >= 120_000);
  });

  it('forecasts nothing while a distinct subscription is idle', async () => {
    const { poller, cycle } = makePoller({
      accounts: ['busy', 'idle'],
      usage: (key, h) => (key === 'busy' ? session(Math.min(100, 30 * h)) : session(5, at(9))),
      config: { pollIntervalMs: 30 * 60_000 },
    });
    for (let h = 0.5; h <= 2.01; h += 0.25) await cycle(h);
    assert.equal(poller.forecasts.size, 0);
    assert.equal(poller.nextDelayMs(), 30 * 60_000);
  });

  it('forecasts two logins of one subscription read in turn', async () => {
    const { poller, cycle, calls } = makePoller({
      accounts: ['token-abc', 'me@example.com'],
      usage: (_key, h) => session(Math.min(100, 30 * h)),
      config: { pollIntervalMs: 30 * 60_000 },
    });
    for (let h = 0.5; h <= 2.01; h += 0.25) await cycle(h);
    assert.equal(calls(), 7, 'one lookup per cycle');
    assert.ok(poller.forecasts.has('claude'));
  });
});
