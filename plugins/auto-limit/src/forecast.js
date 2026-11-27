/**
 * Burn-rate forecasts: where each usage window is heading at its current pace.
 *
 * The poller reads usage every few minutes while the gate is open, which is
 * enough for a fast burn to cross the threshold between polls. Keeping a short
 * history of readings per window lets the poller project when the threshold
 * will be crossed, poll at that moment, and say so ahead of time.
 *
 * @module dsh-plugin-auto-limit/forecast
 */

const HOUR_MS = 3_600_000;

/** Window lengths, and how fast old readings lose weight in the fit. */
const WINDOWS = {
  session: { durationMs: 5 * HOUR_MS, halfLifeMs: HOUR_MS },
  weekly: { durationMs: 7 * 24 * HOUR_MS, halfLifeMs: 24 * HOUR_MS },
  monthly: { durationMs: 30 * 24 * HOUR_MS, halfLifeMs: 4 * 24 * HOUR_MS },
};

/** Usage never falls inside a window, so a larger drop means it reset. */
const DROP_TOLERANCE = 1;
const MAX_SAMPLES = 300;

/**
 * Readings of one window of one account, limited to the window's current
 * period: anything from before its last reset is dropped.
 */
export class WindowHistory {
  constructor(kind) {
    this.spec = WINDOWS[kind];
    this.samples = [];
    this.resetsAt = undefined;
  }

  /**
   * @param window - a normalized window `{ usedPercent, resetsAt? }`.
   * @param at - local epoch ms of the reading.
   */
  record(window, at) {
    if (this.spec === undefined) return;
    const { durationMs } = this.spec;
    // A reading stamped earlier than ones already held means the local clock
    // moved back, so the newer reading wins.
    this.samples = this.samples.filter((sample) => sample.at < at);
    const last = this.samples.at(-1);
    if (last !== undefined && window.usedPercent < last.usedPercent - DROP_TOLERANCE) {
      this.samples = [];
    }
    const resetsAt = typeof window.resetsAt === 'number' ? window.resetsAt : undefined;
    // Both instants come from the provider, so a reset that moved forward
    // marks a new period whatever the local clock says. The tolerance absorbs
    // resets derived from a relative `reset_after_seconds`.
    if (this.resetsAt !== undefined && resetsAt !== undefined && resetsAt - this.resetsAt > durationMs / 20) {
      this.samples = [];
    }
    this.resetsAt = resetsAt;
    if (resetsAt !== undefined) {
      const start = resetsAt - durationMs;
      this.samples = this.samples.filter((sample) => sample.at >= start);
      if (at < start) return;
    }

    const sample = { at, usedPercent: window.usedPercent };
    const previous = this.samples.at(-2);
    if (previous !== undefined && at - previous.at < durationMs / 240) {
      this.samples[this.samples.length - 1] = sample;
    } else {
      this.samples.push(sample);
    }
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  /**
   * @param now - local epoch ms.
   * @returns `{ usedPercent, at, ratePerHour, resetsAt }`, or undefined until
   *   the readings cover a tenth of the window (the first request of a window
   *   is often a large one, and extrapolating it alone would alarm at the start
   *   of most windows) or once the window has reset.
   */
  forecast(now) {
    if (this.spec === undefined) return undefined;
    const samples = this.samples.filter((sample) => sample.at <= now + 60_000);
    const first = samples[0];
    const latest = samples.at(-1);
    if (samples.length < 3 || latest.at - first.at < this.spec.durationMs / 10) return undefined;
    const resetsAt = this.resetsAt ?? latest.at + this.spec.durationMs;
    if (resetsAt <= now) return undefined;
    const slope = weightedSlope(samples, this.spec.halfLifeMs);
    if (slope === undefined) return undefined;
    return { usedPercent: latest.usedPercent, at: latest.at, ratePerHour: Math.max(0, slope), resetsAt };
  }
}

/**
 * Least-squares slope in percent per hour, with weights that decay with age.
 * Usage arrives in bursts, so a plain fit over the last few readings swings
 * between idle and busy, while a decayed fit over the whole period follows the
 * current pace and still damps a single burst.
 */
export function weightedSlope(samples, halfLifeMs) {
  const end = samples.at(-1)?.at;
  if (end === undefined) return undefined;
  const xs = samples.map((sample) => (sample.at - end) / HOUR_MS);
  const ws = samples.map((sample) => 0.5 ** ((end - sample.at) / halfLifeMs));
  const total = ws.reduce((sum, w) => sum + w, 0);
  const meanX = ws.reduce((sum, w, i) => sum + w * xs[i], 0) / total;
  const meanY = ws.reduce((sum, w, i) => sum + w * samples[i].usedPercent, 0) / total;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const dx = xs[i] - meanX;
    covariance += ws[i] * dx * (samples[i].usedPercent - meanY);
    variance += ws[i] * dx * dx;
  }
  return variance > 1e-9 ? covariance / variance : undefined;
}

/**
 * When a forecast reaches a percentage, whether or not the window resets first.
 * @returns epoch ms, or undefined when it never does at this pace.
 */
export function reachesAt(forecast, percent) {
  if (forecast.usedPercent >= percent) return forecast.at;
  if (forecast.ratePerHour <= 0) return undefined;
  return forecast.at + ((percent - forecast.usedPercent) / forecast.ratePerHour) * HOUR_MS;
}

/** Every window's history for one account. */
export class AccountHistory {
  constructor() {
    this.windows = new Map();
  }

  /** @param usage - normalized usage; @param at - local epoch ms. */
  record(usage, at) {
    if (usage?.supported !== true || !Array.isArray(usage.windows)) return;
    for (const window of usage.windows) {
      if (typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) continue;
      const key = `${window.kind}/${window.scope ?? ''}`;
      let history = this.windows.get(key);
      if (history === undefined) {
        history = new WindowHistory(window.kind);
        this.windows.set(key, history);
      }
      history.record(window, at);
    }
  }

  /**
   * When this account first reaches the threshold before a window resets.
   * @param usage - the account's latest reading, naming its current windows.
   * @returns `{ at, window, forecast }` for the first window to close, or
   *   undefined when none is on pace to close before its reset. A window
   *   already over the threshold closes at its reading's time.
   */
  closesAt(usage, threshold, now) {
    if (usage?.supported !== true || !Array.isArray(usage.windows)) return undefined;
    let soonest;
    for (const window of usage.windows) {
      const forecast = this.windows.get(`${window.kind}/${window.scope ?? ''}`)?.forecast(now);
      if (forecast === undefined) continue;
      const at = reachesAt(forecast, threshold);
      if (at === undefined || at >= forecast.resetsAt) continue;
      if (soonest === undefined || at < soonest.at) soonest = { at, window, forecast };
    }
    return soonest;
  }
}

/**
 * When a pooled provider closes: only once every subscription has, since the
 * gate stays open while any one has quota.
 * @param closings - one `closesAt` result per distinct subscription.
 * @returns the last subscription's closing, or undefined when any is not on
 *   pace to close before its reset.
 */
export function poolClosesAt(closings) {
  if (closings.length === 0 || closings.some((closing) => closing === undefined)) return undefined;
  return closings.reduce((last, closing) => (closing.at > last.at ? closing : last));
}

/** An epoch instant for a log line: "11/27/2026, 3:40:00 AM (in 2h 10m)". */
export function formatInstant(epochMs, now = Date.now()) {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return 'an unknown time';
  const delta = epochMs - now;
  const when = new Date(epochMs).toLocaleString();
  if (delta <= 0) return `${when} (due now)`;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${when} (in ${minutes}m)`;
  const hours = Math.floor(minutes / 60);
  return `${when} (in ${hours}h ${minutes % 60}m)`;
}
