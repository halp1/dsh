/**
 * Tests for the pause gate and threshold decisions.
 *
 * The behaviors pinned here are the ones whose failure modes are expensive: a
 * wrong threshold decision pauses (or fails to pause) a real session, and a
 * waiter that is never released hangs a turn forever.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PauseGate, earliestReset, offendingWindow } from '../src/gate.js';

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
    assert.equal(earliestReset(usage, 98), undefined);
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

describe('earliestReset', () => {
  it('picks the soonest reset among offending windows only', () => {
    const usage = {
      supported: true,
      windows: [
        { kind: 'session', usedPercent: 99, resetsAt: 5_000 },
        { kind: 'weekly', usedPercent: 98.5, resetsAt: 3_000 },
        // Below threshold: its earlier reset must not win.
        { kind: 'monthly', usedPercent: 10, resetsAt: 1_000 },
      ],
    };
    assert.equal(earliestReset(usage, 98), 3_000);
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

  it('releases every waiter on dispose so no turn is stranded', async () => {
    const gate = new PauseGate();
    gate.pause('claude', { window: 'weekly', usedPercent: 100 });

    const waiters = [gate.wait('claude'), gate.wait('claude'), gate.wait('claude')];
    gate.dispose();

    await Promise.all(waiters);
    assert.equal(gate.blockReason('claude'), undefined);
  });
});
