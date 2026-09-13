/**
 * The pause gate: per-provider state deciding whether a request may proceed,
 * and the promise a parked request awaits.
 *
 * Design notes worth keeping:
 *
 * - State is per PROVIDER, not per session. A 98% window belongs to the
 *   subscription, so every session sharing that subscription must park on the
 *   same barrier and be released by the same reset.
 *
 * - A parked request waits on a promise that is resolved by the poller, not by
 *   its own timer. That matters because the reset instant the provider
 *   discloses is an estimate the provider can revise; releasing on a fresh
 *   reading rather than on a local clock means a window that reopens early is
 *   picked up, and one that slips does not release into a still-closed window.
 *
 * - Waiters are always released on dispose, so unloading the plugin (or
 *   shutting down) can never strand a turn forever.
 *
 * @module dsh-plugin-auto-limit/gate
 */

/** One provider's gate state. */
class ProviderGate {
  constructor(provider) {
    this.provider = provider;
    /** Why the provider is paused, or undefined when open. */
    this.blocked = undefined;
    /** Resolvers of every request parked on this gate. */
    this.waiters = new Set();
  }

  get isBlocked() {
    return this.blocked !== undefined;
  }
}

/**
 * Holds the pause state of every metered provider.
 */
export class PauseGate {
  /**
   * @param options.onPause - called when a provider transitions open → paused.
   * @param options.onResume - called when a provider transitions paused → open.
   */
  constructor({ onPause, onResume } = {}) {
    this.gates = new Map();
    this.onPause = onPause ?? (() => {});
    this.onResume = onResume ?? (() => {});
    this.disposed = false;
  }

  gateFor(provider) {
    let gate = this.gates.get(provider);
    if (gate === undefined) {
      gate = new ProviderGate(provider);
      this.gates.set(provider, gate);
    }
    return gate;
  }

  /** Current block reason for a provider, or undefined when it may proceed. */
  blockReason(provider) {
    return this.gates.get(provider)?.blocked;
  }

  /** Every currently paused provider and its reason. */
  snapshot() {
    const out = [];
    for (const gate of this.gates.values()) {
      if (gate.isBlocked) out.push({ provider: gate.provider, ...gate.blocked });
    }
    return out;
  }

  /**
   * Mark a provider paused.
   *
   * Re-pausing an already-paused provider updates the reason (the reset
   * instant commonly firms up between polls) WITHOUT releasing anyone — the
   * window is still closed, so waiters must keep waiting.
   * @param provider - provider id.
   * @param reason - `{ window, usedPercent, resetsAt }` describing the block.
   */
  pause(provider, reason) {
    if (this.disposed) return;
    const gate = this.gateFor(provider);
    const wasBlocked = gate.isBlocked;
    gate.blocked = reason;
    if (!wasBlocked) this.onPause(provider, reason);
  }

  /**
   * Mark a provider open and release everything parked on it.
   * @param provider - provider id.
   * @param detail - optional context for the resume notification.
   */
  resume(provider, detail) {
    const gate = this.gates.get(provider);
    if (gate === undefined || !gate.isBlocked) return;
    const previous = gate.blocked;
    gate.blocked = undefined;
    const released = gate.waiters.size;
    for (const release of gate.waiters) release();
    gate.waiters.clear();
    this.onResume(provider, { previous, released, ...detail });
  }

  /**
   * Wait until a provider is open.
   *
   * Resolves immediately when the provider is not paused, so the hot path costs
   * one map lookup. Cancellation is honored: an aborted request must not stay
   * parked, or a user pressing stop would appear to hang.
   * @param provider - provider id.
   * @param signal - the request's abort signal, when it has one.
   * @returns whether the caller waited at all.
   * @throws the abort reason when the caller cancels while parked.
   */
  async wait(provider, signal) {
    const gate = this.gates.get(provider);
    if (gate === undefined || !gate.isBlocked) return false;

    if (signal?.aborted) throw signal.reason ?? new Error('aborted');

    await new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        gate.waiters.delete(release);
        reject(signal.reason ?? new Error('aborted'));
      };
      gate.waiters.add(release);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    // The gate may have re-closed between release and resumption (a fresh
    // poll can find the next window already full). Re-check rather than
    // assuming one release means the path is clear.
    return true;
  }

  /** Release every waiter and stop gating; used on plugin teardown. */
  dispose() {
    this.disposed = true;
    for (const gate of this.gates.values()) {
      gate.blocked = undefined;
      for (const release of gate.waiters) release();
      gate.waiters.clear();
    }
  }
}

/**
 * Decide whether a usage snapshot crosses the pause threshold.
 *
 * Returns the WORST offending window (highest usage), because that is the one
 * whose reset actually governs when work can continue. A window at/over the
 * threshold with no disclosed reset still pauses: not knowing when it reopens
 * is not a reason to keep spending a window the provider says is full.
 * @param usage - normalized provider usage.
 * @param threshold - percent at or above which to pause.
 * @returns the offending window, or undefined when all windows are below it.
 */
export function offendingWindow(usage, threshold) {
  if (usage?.supported !== true || !Array.isArray(usage.windows)) return undefined;
  let worst;
  for (const window of usage.windows) {
    if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) {
      continue;
    }
    if (window.usedPercent < threshold) continue;
    if (worst === undefined || window.usedPercent > worst.usedPercent) worst = window;
  }
  return worst;
}

/**
 * The soonest instant any offending window is expected to reopen.
 * @param usage - normalized provider usage.
 * @param threshold - the pause threshold.
 * @returns epoch ms, or undefined when nothing disclosed a reset.
 */
export function earliestReset(usage, threshold) {
  if (usage?.supported !== true || !Array.isArray(usage.windows)) return undefined;
  let soonest;
  for (const window of usage.windows) {
    if (typeof window.usedPercent !== 'number' || window.usedPercent < threshold) continue;
    if (typeof window.resetsAt !== 'number' || !Number.isFinite(window.resetsAt)) continue;
    if (soonest === undefined || window.resetsAt < soonest) soonest = window.resetsAt;
  }
  return soonest;
}
