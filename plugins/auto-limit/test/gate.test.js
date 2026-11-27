/**
 * Tests for the pause gate and threshold decisions.
 *
 * The behaviors pinned here are the ones whose failure modes are expensive: a
 * wrong threshold decision pauses (or fails to pause) a real session, and a
 * waiter that is never released hangs a turn forever.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PauseGate, governingWindow, offendingWindow } from '../src/gate.js';

describe('offendingWindow', () => {
  it('returns undefined when every window is below the threshold', () => {
    const usage = {
      supported: true,
      windows: [
        { kind: 'session', usedPercent: 97.9 },
        { kind: 'weekly', usedPercent: 12 },
      ],
    };
    assert.equal(offendingWindow(usage, 98), undefined);
  });

  it('pauses exactly at the threshold, not only above it', () => {
    const usage = { supported: true, windows: [{ kind: 'session', usedPercent: 98 }] };
    assert.equal(offendingWindow(usage, 98)?.kind, 'session');
  });

  it('returns the worst window when several are over', () => {
    const usage = {
      supported: true,
      windows: [
        { kind: 'session', usedPercent: 98.2 },
        { kind: 'weekly', usedPercent: 99.7 },
        { kind: 'monthly', usedPercent: 98.5 },
      ],
    };
    assert.equal(offendingWindow(usage, 98)?.kind, 'weekly');
  });

  it('still pauses when the provider disclosed no reset instant', () => {
    const usage = { supported: true, windows: [{ kind: 'weekly', usedPercent: 99 }] };
    assert.notEqual(offendingWindow(usage, 98), undefined);
    assert.equal(governingWindow(usage, 98)?.resetsAt, undefined);
  });

  it('ignores unusable percentages rather than treating them as zero', () => {
    const usage = {
      supported: true,
      windows: [
        { kind: 'session', usedPercent: Number.NaN },
        { kind: 'weekly', usedPercent: 'high' },
      ],
    };
    assert.equal(offendingWindow(usage, 98), undefined);
  });

  it('never pauses on an unsupported or empty snapshot', () => {
    assert.equal(offendingWindow({ supported: false }, 98), undefined);
    assert.equal(offendingWindow({ supported: true, windows: [] }, 98), undefined);
    assert.equal(offendingWindow(undefined, 98), undefined);
  });
});

describe('governingWindow', () => {
  // An account reopens only once every full window has reset.
  const cases = [
    {
      name: 'the latest reset among full windows governs',
      windows: [
        { kind: 'session', usedPercent: 99, resetsAt: 5_000 },
        { kind: 'weekly', usedPercent: 98.5, resetsAt: 300_000 },
        { kind: 'monthly', usedPercent: 10, resetsAt: 900_000 },
      ],
      kind: 'weekly',
      resetsAt: 300_000,
    },
    {
      name: 'a full window with no disclosed reset makes the reopening unknown',
      windows: [
        { kind: 'session', usedPercent: 99, resetsAt: 5_000 },
        { kind: 'weekly', usedPercent: 99 },
      ],
      kind: 'weekly',
      resetsAt: undefined,
    },
    {
      name: 'a below-threshold window never governs',
      windows: [
        { kind: 'session', usedPercent: 99, resetsAt: 5_000 },
        { kind: 'weekly', usedPercent: 50, resetsAt: 300_000 },
      ],
      kind: 'session',
      resetsAt: 5_000,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const result = governingWindow({ supported: true, windows: c.windows }, 98);
      assert.equal(result?.window.kind, c.kind);
      assert.equal(result?.resetsAt, c.resetsAt);
    });
  }

  it('returns undefined when nothing is full', () => {
    assert.equal(governingWindow({ supported: true, windows: [{ kind: 'session', usedPercent: 3 }] }, 98), undefined);
  });
});

describe('PauseGate', () => {
  it('lets requests through while open', async () => {
    const gate = new PauseGate();
    assert.equal(gate.blockReason('claude'), undefined);
    assert.equal(await gate.wait('claude'), false);
  });

  it('parks a request while paused and releases it on resume', async () => {
    const gate = new PauseGate();
    gate.pause('claude', { window: '5-hour', usedPercent: 99, resetsAt: Date.now() + 1000 });

    let released = false;
    const waiter = gate.wait('claude').then(() => {
      released = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(released, false, 'must still be parked while the window is closed');

    gate.resume('claude');
    await waiter;
    assert.equal(released, true);
  });

  it('does not release waiters when a pause is merely updated', async () => {
    const gate = new PauseGate();
    gate.pause('claude', { window: '5-hour', usedPercent: 99, resetsAt: 1 });

    let released = false;
    const waiter = gate.wait('claude').then(() => {
      released = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // A later poll firms up the reset instant; the window is still closed.
    gate.pause('claude', { window: '5-hour', usedPercent: 99.4, resetsAt: 2 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(released, false);

    gate.resume('claude');
    await waiter;
    assert.equal(released, true);
  });

  it('isolates providers from each other', async () => {
    const gate = new PauseGate();
    gate.pause('claude', { window: 'weekly', usedPercent: 100 });
    assert.notEqual(gate.blockReason('claude'), undefined);
    assert.equal(gate.blockReason('codex'), undefined);
    assert.equal(await gate.wait('codex'), false);
  });

  it('fires onPause once per closure and onResume once per release', () => {
    const events = [];
    const gate = new PauseGate({
      onPause: (provider) => events.push(`pause:${provider}`),
      onResume: (provider) => events.push(`resume:${provider}`),
    });

    gate.pause('codex', { window: '5-hour', usedPercent: 98 });
    gate.pause('codex', { window: '5-hour', usedPercent: 99 });
    gate.resume('codex');
    gate.resume('codex');

    assert.deepEqual(events, ['pause:codex', 'resume:codex']);
  });

  it('rejects a parked request when its caller aborts', async () => {
    const gate = new PauseGate();
    gate.pause('claude', { window: '5-hour', usedPercent: 99 });

    const controller = new AbortController();
    const waiter = gate.wait('claude', controller.signal);
    controller.abort(new Error('user stopped the turn'));

    await assert.rejects(waiter, /user stopped the turn/);
  });

  it('refuses to park an already-aborted request', async () => {
    const gate = new PauseGate();
    gate.pause('claude', { window: '5-hour', usedPercent: 99 });
    const controller = new AbortController();
    controller.abort(new Error('already gone'));
    await assert.rejects(gate.wait('claude', controller.signal), /already gone/);
  });

  it('reopens an expiring pause by itself, releasing its waiters', async () => {
    const events = [];
    const gate = new PauseGate({ onResume: (_p, detail) => events.push(detail.cause) });
    gate.pause('claude', { window: 'provider-reported limit', usedPercent: 100 }, { expiresInMs: 20 });
    await gate.wait('claude');
    assert.equal(gate.blockReason('claude'), undefined);
    assert.deepEqual(events, ['expired']);
  });

  it('keeps a pause that replaced an expiring one', async () => {
    const gate = new PauseGate();
    gate.pause('claude', { window: 'provider-reported limit', usedPercent: 100 }, { expiresInMs: 20 });
    // A real reading confirms the window is full; that pause has no expiry.
    gate.pause('claude', { window: 'weekly', usedPercent: 99, resetsAt: Date.now() + 3_600_000 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(gate.blockReason('claude')?.window, 'weekly');
    gate.dispose();
  });

  it('releases every waiter on dispose so no turn is stranded', async () => {
    const gate = new PauseGate();
    gate.pause('claude', { window: 'weekly', usedPercent: 100 });

    const waiters = [gate.wait('claude'), gate.wait('claude'), gate.wait('claude')];
    gate.dispose();

    await Promise.all(waiters);
    assert.equal(gate.blockReason('claude'), undefined);
  });
});
