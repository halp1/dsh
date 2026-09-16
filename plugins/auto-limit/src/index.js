/**
 * dsh-plugin-auto-limit: automatically pause the prompt session when a
 * Claude/Codex subscription usage window (5-hour, weekly, or monthly) linked
 * through `dsh-plugin-subscriptions` reaches the configured threshold, and
 * resume automatically once the window resets and quota is available again.
 *
 * ## How the pause works
 *
 * The plugin installs a listener on the `llm/stream` waterfall — the single
 * point every model call passes through. When the target provider's gate is
 * closed, the listener AWAITS the gate before calling `next()`. The turn is
 * therefore held open rather than failed: the request has not been sent, no
 * tokens are spent, and when the window reopens the very same turn proceeds as
 * if nothing happened. Nothing needs re-prompting.
 *
 * This is the same shape dsh-plugin-subscriptions already uses for a disclosed
 * 429 reset (park the turn, wait out the window), applied one step earlier —
 * before the request is sent, rather than after the provider refuses it.
 *
 * ## Why the gate is per provider
 *
 * A usage window belongs to a subscription, so Claude sitting at 98% says
 * nothing about Codex. Blocking only the affected provider's requests keeps the
 * other subscription usable, and — because `dsh-plugin-subscriptions` pools
 * accounts — a provider is only paused when every logged-in account of it is
 * over threshold.
 *
 * ## What it deliberately does not do
 *
 * It never pauses on a failed usage lookup. An endpoint that is down or
 * rate-limiting its own lookups reports nothing about quota, and pausing on
 * silence would stop a session that has plenty left.
 *
 * @module dsh-plugin-auto-limit
 */

import { PauseGate } from './gate.js';
import { UsagePoller } from './poller.js';
import { METERED_PROVIDERS } from './usage.js';

export const name = 'auto-limit';

/** The LLM runtime is required; everything else is optional. */
export const inject = ['llm'];

export { PauseGate, UsagePoller, METERED_PROVIDERS };

/** Defaults chosen so the plugin is useful with no configuration at all. */
const DEFAULTS = {
  enabled: true,
  threshold: 98,
  // The usage endpoints allow roughly one lookup per minute and rate-limit
  // PROGRESSIVELY (each hit inside a closed window extends it), so polling
  // faster than this does not buy freshness — it buys a lockout, and a locked
  // out poller is a blind gate. Measured against the live Claude endpoint.
  pollIntervalMs: 300_000,
  pausedPollIntervalMs: 120_000,
  providers: [...METERED_PROVIDERS],
  maxHoldMs: 0,
  notify: true,
};

/**
 * Validate and default the plugin config.
 * @param raw - the user's config section.
 * @returns the resolved, immutable config.
 */
export function resolveConfig(raw = {}) {
  const threshold = raw.threshold ?? DEFAULTS.threshold;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    throw new Error('auto-limit: threshold must be a number');
  }
  if (threshold <= 0 || threshold > 100) {
    throw new Error('auto-limit: threshold must be within (0, 100]');
  }

  const pollIntervalMs = raw.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
  if (typeof pollIntervalMs !== 'number' || pollIntervalMs < 60_000) {
    throw new Error(
      'auto-limit: pollIntervalMs must be at least 60000 — the usage endpoints ' +
        'allow ~1 lookup/minute and extend their own lockout when polled faster',
    );
  }

  const pausedPollIntervalMs = raw.pausedPollIntervalMs ?? DEFAULTS.pausedPollIntervalMs;
  if (typeof pausedPollIntervalMs !== 'number' || pausedPollIntervalMs < 60_000) {
    throw new Error('auto-limit: pausedPollIntervalMs must be at least 60000');
  }

  const providers = raw.providers ?? DEFAULTS.providers;
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error('auto-limit: providers must be a non-empty list');
  }
  for (const provider of providers) {
    if (!METERED_PROVIDERS.includes(provider)) {
      throw new Error(
        `auto-limit: unknown provider ${JSON.stringify(provider)}; expected one of ${METERED_PROVIDERS.join(', ')}`,
      );
    }
  }

  const maxHoldMs = raw.maxHoldMs ?? DEFAULTS.maxHoldMs;
  if (typeof maxHoldMs !== 'number' || maxHoldMs < 0) {
    throw new Error('auto-limit: maxHoldMs must be zero (unbounded) or positive');
  }

  return Object.freeze({
    enabled: raw.enabled ?? DEFAULTS.enabled,
    threshold,
    pollIntervalMs,
    pausedPollIntervalMs,
    providers: Object.freeze([...providers]),
    maxHoldMs,
    notify: raw.notify ?? DEFAULTS.notify,
  });
}

/**
 * Read a rate-limit verdict off a terminal stream chunk.
 *
 * The provider's own refusal is the one quota signal that cannot be starved by
 * the usage endpoint's limiter, so it is the gate's backstop. dsh-llm turns an
 * adapter failure into `{type:'finish', reason:{kind:'error', failure}}`, where
 * `failure.code` is the stable taxonomy (`RATE_LIMIT`, `QUOTA_EXCEEDED`) and
 * `providerRetryAfterMs` carries the disclosed reset when the provider sent one.
 * @param chunk - one stream chunk.
 * @returns ms to stay closed, or undefined when the chunk is not a rate-limit refusal.
 */
export function rateLimitSignal(chunk) {
  if (chunk?.type !== 'finish') return undefined;
  const reason = chunk.reason;
  if (reason?.kind !== 'error') return undefined;
  const failure = reason.failure;
  if (failure === undefined) return undefined;

  const rateLimited =
    failure.code === 'RATE_LIMIT' ||
    failure.code === 'QUOTA_EXCEEDED' ||
    failure.status === 429;
  if (!rateLimited) return undefined;

  const disclosed = failure.providerRetryAfterMs;
  if (typeof disclosed === 'number' && Number.isFinite(disclosed) && disclosed > 0) {
    return disclosed;
  }
  // No disclosed reset: hold briefly and let the poller establish the truth,
  // rather than guessing a long window the provider never named.
  return 60_000;
}

/** Format an epoch instant for a human-readable log line. */
function formatReset(resetsAt) {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return 'an unknown time';
  const delta = resetsAt - Date.now();
  const when = new Date(resetsAt).toLocaleString();
  if (delta <= 0) return `${when} (due now)`;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${when} (in ${minutes}m)`;
  const hours = Math.floor(minutes / 60);
  return `${when} (in ${hours}h ${minutes % 60}m)`;
}

/**
 * Install the auto-limit gate.
 * @param ctx - the plugin context.
 * @param rawConfig - the user's config section.
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const logger = ctx.logger('auto-limit');

  if (!config.enabled) {
    logger.info('auto-limit: disabled by config');
    return;
  }

  const gate = new PauseGate({
    onPause: (provider, reason) => {
      logger.warn(
        `auto-limit: pausing ${provider} — ${reason.window} window at ` +
          `${reason.usedPercent.toFixed(1)}% (threshold ${config.threshold}%). ` +
          `Requests are held until ${formatReset(reason.resetsAt)}.`,
      );
    },
    onResume: (provider, detail) => {
      const released = detail.released ?? 0;
      logger.info(
        `auto-limit: resuming ${provider} — quota available again` +
          (released > 0 ? `; released ${released} held request(s)` : '') +
          (detail.cause === 'logged-out' ? ' (account logged out)' : ''),
      );
    },
  });

  const poller = new UsagePoller({ gate, config, logger });

  /**
   * Hold a request until its provider's window reopens.
   *
   * `maxHoldMs` exists as an escape hatch: left at 0 a turn waits as long as it
   * takes (the whole point of the plugin), but an operator who would rather see
   * a turn fail than hang for hours can bound it.
   */
  async function holdUntilOpen(provider, signal) {
    const deadline = config.maxHoldMs > 0 ? Date.now() + config.maxHoldMs : undefined;
    let waited = false;

    // Loop because a release is not a guarantee the next window is open: a
    // fresh poll can find the following window already full.
    while (gate.blockReason(provider) !== undefined) {
      if (deadline !== undefined && Date.now() >= deadline) {
        const reason = gate.blockReason(provider);
        throw new Error(
          `auto-limit: ${provider} still paused (${reason?.window} window at ` +
            `${reason?.usedPercent?.toFixed?.(1)}%) after waiting ` +
            `${Math.round(config.maxHoldMs / 1000)}s; giving up on this turn.`,
        );
      }
      waited = (await gate.wait(provider, signal)) || waited;
    }
    return waited;
  }

  ctx.on('llm/stream', async function* (options, next) {
    const provider = options.provider;

    // Untracked providers and unmetered routes pass straight through.
    if (!config.providers.includes(provider)) {
      yield* next();
      return;
    }

    if (gate.blockReason(provider) !== undefined) {
      const reason = gate.blockReason(provider);
      logger.info(
        `auto-limit: holding a ${provider} request — ${reason.window} window at ` +
          `${reason.usedPercent.toFixed(1)}%; waiting for reset at ${formatReset(reason.resetsAt)}.`,
      );
      await holdUntilOpen(provider, options.signal);
      logger.info(`auto-limit: released a held ${provider} request; continuing the turn.`);
    }

    // Watch the stream itself for the provider's own rate-limit verdict.
    //
    // Polling can go blind (the usage endpoints rate-limit their own lookups
    // aggressively), and when it does, the gate would otherwise stay open right
    // through 100%. The model traffic is the one signal that cannot be starved:
    // if the provider says the window is closed, that is authoritative, so the
    // gate closes on it regardless of what polling knows.
    for await (const chunk of next()) {
      const retryAfterMs = rateLimitSignal(chunk);
      if (retryAfterMs !== undefined) {
        gate.pause(provider, {
          window: 'provider-reported limit',
          usedPercent: 100,
          resetsAt: Date.now() + retryAfterMs,
          source: 'stream',
        });
        // Ask the poller to confirm with a real reading once the budget allows.
        poller.schedule(Math.min(retryAfterMs, 60_000));
      }
      yield chunk;
    }
  });

  // Deliberately NOT refreshing on turn end.
  //
  // An earlier version polled 5–15s after every completed turn, reasoning that
  // usage had just moved. On a busy session that fires constantly, and against
  // an endpoint that allows ~1 lookup/minute and extends its lockout on every
  // excess hit, it guaranteed a permanent 429 — which is precisely how the gate
  // went blind and let a window run from 98% to 100%. The fixed interval, the
  // tightening cadence near a disclosed reset, and the stream-level rate-limit
  // backstop cover this without spending calls the budget does not have.

  poller.start();
  logger.info(
    `auto-limit: watching ${config.providers.join(', ')} at ${config.threshold}% ` +
      `(poll ${Math.round(config.pollIntervalMs / 1000)}s, ` +
      `${Math.round(config.pausedPollIntervalMs / 1000)}s while paused)`,
  );

  ctx.on('dispose', () => {
    poller.stop();
    gate.dispose();
  });
}
