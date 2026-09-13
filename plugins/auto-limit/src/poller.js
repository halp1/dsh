/**
 * The usage poller: refreshes each logged-in subscription's usage and drives
 * the {@link PauseGate}.
 *
 * Polling cadence is deliberately adaptive rather than a single fixed interval:
 *
 * - While a provider is OPEN, poll on the normal interval. Usage only moves
 *   when requests are made, so there is nothing to gain from polling hard.
 * - While a provider is PAUSED, poll faster as the disclosed reset approaches,
 *   and keep polling after it passes. The reset instant is the provider's
 *   estimate; the authoritative signal that quota is back is the usage endpoint
 *   reporting a below-threshold number, so release is always driven by a real
 *   reading rather than by a local clock.
 *
 * Failures never pause and never resume. A usage endpoint that is down, rate-
 * limiting its own lookups, or serving a 401 says nothing about quota, and
 * guessing in either direction is worse than holding the last known state:
 * guessing "full" would pause a healthy session, guessing "empty" would release
 * a parked turn into a closed window.
 *
 * @module dsh-plugin-auto-limit/poller
 */

import {
  METERED_PROVIDERS,
  accountsOf,
  describeWindow,
  fetchUsage,
  loadAuthStore,
} from './usage.js';
import { earliestReset, offendingWindow } from './gate.js';

/** Bound on one usage lookup, so a hung endpoint cannot stall the poll loop. */
const USAGE_TIMEOUT_MS = 10_000;

/** Cooldown after a failed lookup, so a broken endpoint is not hammered. */
const FAILURE_COOLDOWN_MS = 60_000;

/** Never poll more often than this, whatever the reset math suggests. */
const MIN_POLL_MS = 5_000;

export class UsagePoller {
  /**
   * @param options.gate - the pause gate to drive.
   * @param options.config - resolved plugin config.
   * @param options.logger - cordis logger.
   */
  constructor({ gate, config, logger }) {
    this.gate = gate;
    this.config = config;
    this.logger = logger;
    this.timer = undefined;
    this.stopped = false;
    /** provider → epoch ms before which no lookup should be attempted. */
    this.cooldownUntil = new Map();
    /** Guards against overlapping runs when a poll outlives its interval. */
    this.running = false;
  }

  start() {
    if (this.stopped) return;
    void this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Schedule the next poll, at a delay reflecting current gate state. */
  schedule(delayMs) {
    if (this.stopped) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    const delay = Math.max(MIN_POLL_MS, delayMs);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, delay);
    // Never hold the process open just to poll usage.
    this.timer?.unref?.();
  }

  /**
   * How long to wait before the next poll.
   *
   * A paused provider with a known reset drives the cadence: poll shortly after
   * the reset is due, and meanwhile no slower than the paused interval so a
   * revised (earlier) reset is still noticed.
   */
  nextDelayMs() {
    const paused = this.gate.snapshot();
    if (paused.length === 0) return this.config.pollIntervalMs;

    const now = Date.now();
    let soonest = this.config.pausedPollIntervalMs;
    for (const entry of paused) {
      if (typeof entry.resetsAt !== 'number') continue;
      // Poll a beat after the disclosed reset, to let the provider's own
      // bookkeeping catch up before asking.
      const untilReset = entry.resetsAt + 2_000 - now;
      if (untilReset > 0) soonest = Math.min(soonest, untilReset);
    }
    return soonest;
  }

  /** One full pass over every metered provider, then reschedule. */
  async tick() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      await this.refreshAll();
    } catch (error) {
      this.logger.warn(`auto-limit: poll failed: ${describeError(error)}`);
    } finally {
      this.running = false;
      this.schedule(this.nextDelayMs());
    }
  }

  /** Refresh every metered provider that has a stored login. */
  async refreshAll() {
    const store = await loadAuthStore();
    const providers = METERED_PROVIDERS.filter(
      (provider) => this.config.providers.includes(provider),
    );
    await Promise.all(providers.map((provider) => this.refreshProvider(store, provider)));
  }

  /**
   * Refresh one provider and apply the pause/resume decision.
   *
   * With several accounts of one provider logged in, the provider is only
   * paused when EVERY account is over threshold: dsh-plugin-subscriptions can
   * pool accounts and route around a full one, so pausing while another account
   * still has quota would stop work that could have continued.
   */
  async refreshProvider(store, provider) {
    const accounts = accountsOf(store, provider);
    if (accounts.length === 0) {
      // Logged out: nothing to meter, and any stale pause must not outlive the
      // login it was based on.
      this.gate.resume(provider, { cause: 'logged-out' });
      return;
    }

    const cooldown = this.cooldownUntil.get(provider) ?? 0;
    if (Date.now() < cooldown) return;

    const readings = [];
    for (const { key, session } of accounts) {
      const usage = await this.readUsage(provider, key, session);
      if (usage !== undefined) readings.push({ key, usage });
    }

    if (readings.length === 0) {
      // Every account failed to report. Hold current state and back off.
      this.cooldownUntil.set(provider, Date.now() + FAILURE_COOLDOWN_MS);
      return;
    }
    this.cooldownUntil.delete(provider);

    const offenders = readings.map(({ key, usage }) => ({
      key,
      usage,
      window: offendingWindow(usage, this.config.threshold),
    }));

    const usable = offenders.filter((entry) => entry.window === undefined);
    if (usable.length > 0) {
      this.gate.resume(provider, { cause: 'quota-available', account: usable[0].key });
      return;
    }

    // Every account is over threshold; pause on the one that reopens soonest.
    let best;
    for (const entry of offenders) {
      const resetsAt = earliestReset(entry.usage, this.config.threshold);
      if (
        best === undefined ||
        (resetsAt !== undefined &&
          (best.resetsAt === undefined || resetsAt < best.resetsAt))
      ) {
        best = { entry, resetsAt };
      }
    }

    this.gate.pause(provider, {
      window: describeWindow(best.entry.window),
      usedPercent: best.entry.window.usedPercent,
      resetsAt: best.resetsAt,
      account: best.entry.key,
    });
  }

  /**
   * Read one account's usage, bounded by a timeout.
   * @returns the usage, or undefined when the lookup failed.
   */
  async readUsage(provider, key, session) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
    try {
      return await fetchUsage(provider, session, controller.signal);
    } catch (error) {
      this.logger.debug?.(
        `auto-limit: ${provider}/${key} usage lookup failed: ${describeError(error)}`,
      );
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A log-safe one-line description of a thrown value. */
function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
