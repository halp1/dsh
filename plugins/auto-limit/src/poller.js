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
import { governingWindow, offendingWindow } from './gate.js';
import { AccountHistory, formatInstant, poolClosesAt } from './forecast.js';

/** Bound on one usage lookup, so a hung endpoint cannot stall the poll loop. */
const USAGE_TIMEOUT_MS = 10_000;

/**
 * Cooldown after a failed lookup.
 *
 * Five minutes, matching dsh-plugin-subscriptions' own quota cooldown, because
 * the usage endpoints rate-limit PROGRESSIVELY: every hit inside a closed
 * window extends the next one, so a caller that retries briskly can keep an
 * account locked out indefinitely. Measured against the live Claude endpoint:
 * a second call ~0.5s after the first returns 429 with `retry-after: 0`, and
 * after a six-call burst the endpoint was still refusing 65s later, only
 * recovering at ~130s. `retry-after: 0` is therefore a lie that must never be
 * taken literally.
 */
const FAILURE_COOLDOWN_MS = 5 * 60_000;

/**
 * Minimum spacing between two usage calls on one provider, across ALL accounts.
 *
 * The limiter is per subscription, not per process or per account, so the calls
 * must be spaced globally rather than merely deduped.
 */
const MIN_CALL_SPACING_MS = 60_000;

/**
 * Never poll more often than this, whatever the reset math suggests.
 *
 * Raised from 5s to 60s after the endpoint's real budget (~1 call/minute) was
 * measured; a 5s floor was fast enough to keep the account permanently locked
 * out of its own usage readings.
 */
const MIN_POLL_MS = 60_000;

/**
 * How long a usage reading is trusted before the gate stops believing it.
 *
 * Past this, readings are stale and the plugin says so loudly instead of
 * quietly assuming the last-known-good number still holds.
 */
const STALE_AFTER_MS = 15 * 60_000;

/**
 * How long to defer a pause decision while some account has never answered.
 *
 * Bounded on purpose. An unread account is a reason for caution, not a reason
 * to stay open forever: a usage endpoint that never answers would otherwise
 * hold the gate open through 100%, which is the exact failure this plugin
 * exists to prevent. Ten minutes is several rotation cycles — long enough for a
 * transient refusal to clear, short enough that real quota is not lost.
 */
const UNREAD_GRACE_MS = 10 * 60_000;

/**
 * Floor on a poll brought forward by a forecast. Twice the endpoint's budget,
 * so a forecast that keeps landing just ahead cannot pin polling at the limit.
 */
const FORECAST_MIN_POLL_MS = 120_000;

/** A forecast that moves by less than this is not logged again. */
const FORECAST_LOG_SHIFT_MS = 15 * 60_000;

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
    /** provider → epoch ms of the last usage CALL, for global call spacing. */
    this.lastCallAt = new Map();
    /** provider → epoch ms of the last SUCCESSFUL reading, for staleness. */
    this.lastGoodAt = new Map();
    /** Providers already warned about stale data, so the warning fires once. */
    this.staleWarned = new Set();
    /** `provider/account` → `{ usage, at }`, so a spaced-out cycle still sees
     * a recently-read account instead of treating it as unknown. */
    this.readingCache = new Map();
    /** provider → index of the account the next cycle should start from. */
    this.rotation = new Map();
    /** provider → epoch ms it first deferred a decision on an unread account. */
    this.deferredSince = new Map();
    /** Guards against overlapping runs when a poll outlives its interval. */
    this.running = false;
    /** `provider/account` → {@link AccountHistory} of fresh readings. */
    this.histories = new Map();
    /** provider → when the open gate is on pace to close, `{ at, window, forecast }`. */
    this.forecasts = new Map();
  }

  /**
   * Warn once when a provider's usage data has gone stale.
   *
   * Silent blindness is the failure that let a window run from 98% to 100%: the
   * gate held "open" because it had no reading, and nothing said so. A stale
   * gate is now loud, so the situation is visible while it is happening rather
   * than afterwards.
   */
  noteStale(provider) {
    const lastGood = this.lastGoodAt.get(provider);
    const age = lastGood === undefined ? undefined : Date.now() - lastGood;
    if (age !== undefined && age < STALE_AFTER_MS) return;
    if (this.staleWarned.has(provider)) return;
    this.staleWarned.add(provider);
    this.logger.warn(
      `auto-limit: ${provider} usage data is STALE` +
        (age === undefined
          ? ' (no successful reading yet)'
          : ` (last good reading ${Math.round(age / 60_000)}m ago)`) +
        ' — the gate cannot see your quota, so limits are NOT being enforced' +
        ' for this provider. Usage lookups are being refused (the endpoint' +
        ' rate-limits them); they will be retried automatically.',
    );
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
    const now = Date.now();
    const paused = this.gate.snapshot();
    let soonest = paused.length === 0 ? this.config.pollIntervalMs : this.config.pausedPollIntervalMs;
    // Poll when a forecast says the threshold will be crossed, so a fast burn
    // is caught there rather than up to a full interval later.
    for (const closing of this.forecasts.values()) {
      soonest = Math.min(soonest, Math.max(FORECAST_MIN_POLL_MS, closing.at - now));
    }

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

  /**
   * Refresh every metered provider that has a stored login.
   *
   * Providers are refreshed SEQUENTIALLY. Running them concurrently was safe
   * for correctness but meant several usage endpoints were hit in the same
   * instant, and the pacing this class now depends on is easier to reason about
   * when exactly one lookup is ever in flight.
   */
  async refreshAll() {
    const store = await loadAuthStore();
    const providers = METERED_PROVIDERS.filter(
      (provider) => this.config.providers.includes(provider),
    );
    for (const provider of providers) {
      await this.refreshProvider(store, provider);
      // Any provider whose data has aged out must say so, even when this cycle
      // never reached its endpoint (cooldown, spacing, or an early break).
      this.checkStale(provider);
    }
  }

  /** Remember one account's reading for reuse while call spacing is in effect. */
  cacheReading(provider, account, usage) {
    this.readingCache.set(`${provider}/${account}`, { usage, at: Date.now() });
  }

  /**
   * A recent cached reading for one account.
   * @returns the usage when still within the staleness bound, else undefined.
   */
  cachedReading(provider, account) {
    const entry = this.readingCache.get(`${provider}/${account}`);
    if (entry === undefined) return undefined;
    if (Date.now() - entry.at > STALE_AFTER_MS) return undefined;
    return entry.usage;
  }

  /**
   * Whether every account of a provider has been read at least once.
   *
   * Until that holds, a pause decision is made on partial information; after
   * it, a deferred account is covered by its cached reading.
   */
  everyAccountSeen(provider, accounts) {
    return accounts.every((entry) => this.readingCache.has(`${provider}/${entry.key}`));
  }

  /** Warn when a provider's last good reading has aged past the stale bound. */
  checkStale(provider) {
    const lastGood = this.lastGoodAt.get(provider);
    if (lastGood === undefined) return; // startup; noteStale covers a hard failure
    if (Date.now() - lastGood < STALE_AFTER_MS) return;
    this.noteStale(provider);
  }

  /**
   * Refresh one provider and apply the pause/resume decision.
   *
   * Accounts are polled ONE AT A TIME with global spacing, and a reading is
   * reused for every account that shares the same subscription. Two logins of
   * one Claude subscription report identical usage, so polling both spends two
   * calls against a ~1/minute budget to learn one number — which is exactly how
   * the endpoint got wedged into a permanent 429 and the gate went blind.
   *
   * With genuinely distinct subscriptions the provider is paused only when
   * EVERY one is over threshold, since dsh-plugin-subscriptions can route
   * around a full account.
   */
  async refreshProvider(store, provider) {
    const accounts = accountsOf(store, provider);
    if (accounts.length === 0) {
      // Logged out: nothing to meter, and any stale pause must not outlive the
      // login it was based on.
      this.gate.resume(provider, { cause: 'logged-out' });
      this.forecasts.delete(provider);
      return;
    }

    const cooldown = this.cooldownUntil.get(provider) ?? 0;
    if (Date.now() < cooldown) return;

    // Enforce the call budget ACROSS cycles, not just within one. The scheduler
    // paces normal cycles, but anything triggering an out-of-band refresh (a
    // stream rate-limit signal, a manual schedule, a restart loop) must not
    // stack a call on top of a recent one — that stacking is exactly what drove
    // the endpoint into a lockout it never came out of.
    const sinceLastCall = Date.now() - (this.lastCallAt.get(provider) ?? 0);
    if (sinceLastCall < MIN_CALL_SPACING_MS) return;

    // Start each cycle where the last one stopped. Without this rotation a
    // spaced-out cycle would always read the first account and never reach the
    // second, leaving it permanently unread — and therefore leaving a genuinely
    // exhausted provider permanently un-paused.
    const start = this.rotation.get(provider) ?? 0;
    const ordered = accounts.map(
      (_, index) => accounts[(start + index) % accounts.length],
    );

    const readings = [];
    let unread = 0;
    let advanced = start;
    for (const { key, session } of ordered) {
      // Space calls globally: the limiter is per subscription, and a burst
      // extends its own lockout.
      if (readings.length > 0) {
        const since = Date.now() - (this.lastCallAt.get(provider) ?? 0);
        // One reading already in hand and the budget not yet replenished: defer
        // the rest. A second subscription is picked up on a later cycle, which
        // costs freshness on a rare setup but never costs the lockout that
        // blinds the gate entirely.
        if (since < MIN_CALL_SPACING_MS) {
          // Reuse a recent cached reading rather than counting the account as
          // unknown; only a genuinely unseen account forces caution below.
          const cached = this.cachedReading(provider, key);
          if (cached !== undefined) {
            const dup = readings.find((entry) => sameSubscription(entry.usage, cached));
            if (dup !== undefined) dup.keys.push(key);
            else readings.push({ key, keys: [key], usage: cached, fresh: false });
          } else {
            unread += 1;
          }
          continue;
        }
      }

      this.lastCallAt.set(provider, Date.now());
      advanced = (accounts.findIndex((entry) => entry.key === key) + 1) % accounts.length;
      this.rotation.set(provider, advanced);
      const usage = await this.readUsage(provider, key, session);
      if (usage === undefined) {
        // A refused lookup means the limiter is already closed, so stop asking
        // this cycle. Before breaking, fall back to recent cached readings for
        // this account and the ones after it: dropping everything on a single
        // refusal is how a rotation that happens to start on the throttled
        // account blinds an entire cycle, even though a good reading for the
        // other account is sitting in the cache.
        for (const pending of ordered.slice(ordered.findIndex((e) => e.key === key))) {
          const cached = this.cachedReading(provider, pending.key);
          if (cached === undefined) {
            unread += 1;
            continue;
          }
          const dup = readings.find((entry) => sameSubscription(entry.usage, cached));
          if (dup !== undefined) dup.keys.push(pending.key);
          else readings.push({ key: pending.key, keys: [pending.key], usage: cached, fresh: false });
        }
        break;
      }
      this.cacheReading(provider, key, usage);

      const duplicate = readings.find((entry) => sameSubscription(entry.usage, usage));
      if (duplicate !== undefined) {
        duplicate.keys.push(key);
        duplicate.fresh = true;
        continue;
      }
      readings.push({ key, keys: [key], usage, fresh: true });
    }

    if (readings.length === 0) {
      // Every account failed to report. Hold current state and back off.
      this.cooldownUntil.set(provider, Date.now() + FAILURE_COOLDOWN_MS);
      this.noteStale(provider);
      return;
    }
    this.cooldownUntil.delete(provider);
    this.lastGoodAt.set(provider, Date.now());
    this.staleWarned.delete(provider);
    this.recordHistory(provider, readings);

    const offenders = readings.map(({ key, usage }) => ({
      key,
      usage,
      window: offendingWindow(usage, this.config.threshold),
    }));

    const usable = offenders.filter((entry) => entry.window === undefined);
    if (usable.length > 0) {
      this.gate.resume(provider, { cause: 'quota-available', account: usable[0].key });
      this.updateForecast(provider, unread > 0 ? undefined : this.poolClosing(provider, offenders));
      return;
    }
    this.updateForecast(provider, undefined);

    if (unread > 0 && !this.everyAccountSeen(provider, accounts)) {
      // An account of this provider has never been read, so "every
      // subscription is full" is not yet established: the unseen one may still
      // have quota, and pausing on that guess would stop usable work.
      //
      // But this deference MUST expire. If the unseen account can never be read
      // — which is exactly what a persistently throttled usage endpoint looks
      // like — then waiting for certainty means waiting forever, and the gate
      // stays open through 100%. That is the original bug wearing a new hat.
      //
      // So: defer only while there is reason to expect an answer soon. Past the
      // grace period, act on the readings actually in hand. Erring toward
      // pausing is right here, because a needless pause costs a wait the user
      // can see and override, while a missed pause costs real quota silently.
      const waitingSince = this.deferredSince.get(provider) ?? Date.now();
      this.deferredSince.set(provider, waitingSince);

      if (Date.now() - waitingSince < UNREAD_GRACE_MS) return;

      this.logger.warn(
        `auto-limit: ${provider} has an account that has not answered a usage ` +
          `lookup in ${Math.round((Date.now() - waitingSince) / 60_000)}m; ` +
          'deciding on the accounts that did answer rather than staying open ' +
          'indefinitely.',
      );
    }
    this.deferredSince.delete(provider);

    // Every account is over threshold; pause on the one that reopens soonest.
    let best;
    for (const entry of offenders) {
      const governing = governingWindow(entry.usage, this.config.threshold);
      if (
        best === undefined ||
        (governing.resetsAt !== undefined &&
          (best.governing.resetsAt === undefined || governing.resetsAt < best.governing.resetsAt))
      ) {
        best = { entry, governing };
      }
    }

    this.gate.pause(provider, {
      window: describeWindow(best.governing.window),
      usedPercent: best.governing.window.usedPercent,
      resetsAt: best.governing.resetsAt,
      account: best.entry.key,
    });
  }

  historyFor(provider, key) {
    const id = `${provider}/${key}`;
    let history = this.histories.get(id);
    if (history === undefined) {
      history = new AccountHistory();
      this.histories.set(id, history);
    }
    return history;
  }

  /**
   * Record this cycle's fresh readings under the login that was read. Logins
   * of one subscription read in turn each keep every other reading, which is
   * still enough to fit a pace.
   */
  recordHistory(provider, readings) {
    for (const entry of readings) {
      if (entry.fresh) this.historyFor(provider, entry.key).record(entry.usage, Date.now());
    }
  }

  /** When every subscription of a provider is on pace to be over threshold. */
  poolClosing(provider, offenders) {
    const now = Date.now();
    return poolClosesAt(
      offenders.map(({ key, usage, window }) =>
        window !== undefined
          ? { at: now, window }
          : this.historyFor(provider, key).closesAt(usage, this.config.threshold, now),
      ),
    );
  }

  /** Keep a provider's forecast and log when it appears, moves, or clears. */
  updateForecast(provider, closing) {
    const previous = this.forecasts.get(provider);
    if (closing === undefined) {
      if (previous === undefined) return;
      this.forecasts.delete(provider);
      if (this.gate.blockReason(provider) === undefined) {
        this.logger.info(`auto-limit: ${provider} is no longer on pace to reach ${this.config.threshold}% before reset.`);
      }
      return;
    }
    this.forecasts.set(provider, closing);
    if (previous !== undefined && Math.abs(previous.at - closing.at) < FORECAST_LOG_SHIFT_MS) return;
    const { window, forecast } = closing;
    this.logger.info(
      `auto-limit: ${provider} is on pace to reach ${this.config.threshold}% at ` +
        `${formatInstant(closing.at)}` +
        (forecast === undefined
          ? ''
          : ` (${describeWindow(window)} window at ${forecast.usedPercent.toFixed(1)}%, ` +
            `+${forecast.ratePerHour.toFixed(1)}%/h, resets ${formatInstant(forecast.resetsAt)})`) +
        '.',
    );
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

/**
 * Whether two readings describe the same underlying subscription.
 *
 * Several logins of one subscription report byte-identical windows: the same
 * percentages against the same reset instants. Comparing the reset instants
 * (rather than only the percentages, which coincide freely at low usage) makes
 * a false match essentially impossible — two distinct subscriptions would have
 * to share every window's reset to the millisecond.
 *
 * This is what stops the poller from spending one call per login to learn a
 * single number against a ~1-call-per-minute budget.
 * @param a - one reading.
 * @param b - the other.
 * @returns whether they are the same subscription.
 */
export function sameSubscription(a, b) {
  const aw = a?.windows;
  const bw = b?.windows;
  if (!Array.isArray(aw) || !Array.isArray(bw)) return false;
  if (aw.length === 0 || aw.length !== bw.length) return false;
  return aw.every((window, index) => {
    const other = bw[index];
    if (window.kind !== other.kind) return false;
    if (window.usedPercent !== other.usedPercent) return false;
    // Resets are the discriminator; both absent is only a match when the
    // percentages already agree and neither window is anchored in time.
    return window.resetsAt === other.resetsAt;
  });
}
