/**
 * The pause controller: one gate shared by every agent in the process.
 *
 * Inputs arrive from the native watcher (lid, power, network) and from the
 * reachability probe. The gate closes immediately on any hard reason (lid
 * closed, system going to sleep, and optionally network loss). It reopens
 * only when every hard reason is gone AND the network is up AND a real TCP
 * connection succeeded AND a short settle delay elapsed. Interface-level
 * reachability alone is not trusted, because Wi-Fi reports "satisfied" well
 * before DHCP and DNS are usable after a wake.
 *
 * @module dsh-plugin-lid-pause/state
 */

/** Abort reason carried by the per-pause signal. */
export class PausedError extends Error {
  constructor(reasons) {
    super(`lid-pause: paused (${reasons.join(', ')})`);
    this.name = 'PausedError';
    this.reasons = reasons;
  }
}

export class PauseController {
  /**
   * @param options.config - resolved plugin config.
   * @param options.probe - async () => boolean, a real connectivity check.
   * @param options.onChange - called with a status object on every transition.
   * @param options.now - clock, injectable for tests.
   */
  constructor({ config, probe, onChange = () => {}, now = Date.now }) {
    this.config = config;
    this.probe = probe;
    this.onChange = onChange;
    this.now = now;

    this.lidClosed = false;
    this.asleep = false;
    this.networkUp = true;
    this.probeOk = true;

    this.open = true;
    this.phase = 'open';
    this.pausedAt = undefined;
    this.lastWakeAt = undefined;
    this.waiters = new Set();
    this.pauseAbort = new AbortController();

    this.probing = false;
    this.probeTimer = undefined;
    this.resumeTimer = undefined;
    this.disposed = false;
  }

  // Inputs

  setLid(closed) {
    if (this.lidClosed === closed) return;
    this.lidClosed = closed;
    if (closed) this.probeOk = false;
    this.evaluate();
  }

  setPower(state) {
    if (state === 'will-sleep') {
      if (this.asleep) return;
      this.asleep = true;
      this.probeOk = false;
    } else if (state === 'did-wake') {
      this.lastWakeAt = this.now();
      if (!this.asleep) {
        // A wake without a recorded sleep (missed message, clock jump) still
        // means sockets may be dead, so re-verify connectivity when paused.
        this.evaluate();
        return;
      }
      this.asleep = false;
    } else {
      return;
    }
    this.evaluate();
  }

  setNetwork(up) {
    if (this.networkUp === up) return;
    this.networkUp = up;
    if (!up) this.probeOk = false;
    this.evaluate();
  }

  // Queries

  isOpen() {
    return this.open;
  }

  /** Hard reasons the gate must stay closed, in a stable order. */
  hardReasons() {
    const reasons = [];
    if (this.config.pauseOnLidClose && this.lidClosed) reasons.push('lid closed');
    if (this.config.pauseOnSleep && this.asleep) reasons.push('sleep');
    if (this.config.pauseOnNetworkLoss && !this.networkUp) reasons.push('network down');
    return reasons;
  }

  /** Whether `at` falls inside the grace window that follows a wake. */
  inWakeGrace(at = this.now()) {
    return this.lastWakeAt !== undefined && at - this.lastWakeAt <= this.config.wakeGraceMs;
  }

  /** The signal that fires when the current open period ends. */
  get pauseSignal() {
    return this.pauseAbort.signal;
  }

  status() {
    return {
      open: this.open,
      phase: this.phase,
      reasons: this.hardReasons(),
      lidClosed: this.lidClosed,
      asleep: this.asleep,
      networkUp: this.networkUp,
      pausedAt: this.pausedAt,
      held: this.waiters.size,
    };
  }

  /**
   * Resolve once the gate is open. Rejects with the signal's reason when the
   * caller cancels while held, so pressing Stop never appears to hang.
   * @returns whether the caller had to wait.
   */
  async wait(signal) {
    if (this.open || this.disposed) return false;
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    await new Promise((resolve, reject) => {
      const release = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        this.waiters.delete(release);
        reject(signal.reason ?? new Error('aborted'));
      };
      this.waiters.add(release);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return true;
  }

  // Transitions

  evaluate() {
    if (this.disposed) return;
    const reasons = this.hardReasons();

    if (reasons.length > 0) {
      this.clearResumeTimers();
      if (this.open) {
        this.open = false;
        this.pausedAt = this.now();
        this.phase = 'paused';
        this.pauseAbort.abort(new PausedError(reasons));
        this.emit('paused');
      } else if (this.phase !== 'paused') {
        this.phase = 'paused';
        this.emit('paused');
      }
      return;
    }

    if (this.open) return;

    if (!this.networkUp) {
      this.clearResumeTimers();
      this.setPhase('waiting-network');
      return;
    }

    if (!this.probeOk) {
      this.setPhase('probing');
      this.runProbe();
      return;
    }

    if (this.resumeTimer === undefined) {
      this.setPhase('settling');
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = undefined;
        if (this.hardReasons().length === 0 && this.networkUp && this.probeOk) this.reopen();
        else this.evaluate();
      }, this.config.resumeDelayMs);
      this.resumeTimer.unref?.();
    }
  }

  runProbe() {
    if (this.probing || this.probeTimer !== undefined) return;
    if (this.probe === undefined) {
      this.probeOk = true;
      this.evaluate();
      return;
    }
    this.probing = true;
    Promise.resolve()
      .then(() => this.probe())
      .catch(() => false)
      .then((ok) => {
        this.probing = false;
        if (this.disposed) return;
        if (ok) {
          this.probeOk = true;
        } else {
          this.probeTimer = setTimeout(() => {
            this.probeTimer = undefined;
            this.evaluate();
          }, this.config.probe.retryMs);
          this.probeTimer.unref?.();
        }
        this.evaluate();
      });
  }

  reopen() {
    const released = this.waiters.size;
    const pausedFor = this.pausedAt === undefined ? 0 : this.now() - this.pausedAt;
    this.open = true;
    this.phase = 'open';
    this.pausedAt = undefined;
    this.pauseAbort = new AbortController();
    for (const release of this.waiters) release();
    this.waiters.clear();
    this.emit('resumed', { released, pausedFor });
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit(phase);
  }

  clearResumeTimers() {
    if (this.resumeTimer !== undefined) clearTimeout(this.resumeTimer);
    if (this.probeTimer !== undefined) clearTimeout(this.probeTimer);
    this.resumeTimer = undefined;
    this.probeTimer = undefined;
  }

  emit(event, detail = {}) {
    try {
      this.onChange({ event, ...this.status(), ...detail });
    } catch {
      // A logging failure must never wedge the gate.
    }
  }

  /** Release every waiter and stop gating. Used on plugin teardown. */
  dispose() {
    this.disposed = true;
    this.clearResumeTimers();
    this.open = true;
    for (const release of this.waiters) release();
    this.waiters.clear();
  }
}
