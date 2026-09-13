/**
 * Subscription usage reading for dsh-plugin-auto-limit.
 *
 * `dsh-plugin-subscriptions` owns the OAuth sessions and already knows how to
 * read each provider's usage endpoint, but it exports neither the fetchers nor
 * the store (its package `exports` map exposes only `.` and `./client`, so a
 * deep import is not a supported seam and would break on any refactor). What it
 * DOES own durably is the on-disk token file, whose format it documents as the
 * durable contract. So this module reads that file and re-implements the two
 * usage calls against the same endpoints, headers, and payload shapes.
 *
 * Consequence to keep in mind when upgrading: the window-parsing here mirrors
 * dsh-plugin-subscriptions 0.9.0. It is written defensively (every field is
 * validated, unknown shapes degrade to "no reading" rather than to a wrong
 * reading) because a misread usage number here would pause a session that has
 * quota left, which is worse than not pausing at all.
 *
 * @module dsh-plugin-auto-limit/usage
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Providers that expose a usage endpoint this plugin can meter. */
export const METERED_PROVIDERS = Object.freeze(['claude', 'codex']);

/** The token file dsh-plugin-subscriptions owns; shared read-only from here. */
export function authFilePath() {
  return join(homedir(), '.dsh', 'plugins', 'subscriptions', 'auth.json');
}

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

/** Canonical window lengths in seconds, used to classify a codex window. */
const SESSION_WINDOW_SECONDS = 300 * 60;
const WEEKLY_WINDOW_SECONDS = 10080 * 60;
/** A month is not a fixed length; accept the 28–31 day band. */
const MONTHLY_WINDOW_SECONDS_MIN = 28 * 24 * 60 * 60;
const MONTHLY_WINDOW_SECONDS_MAX = 31 * 24 * 60 * 60;

/**
 * Read the shared session store.
 *
 * Absent file means "no subscriptions logged in", which is a normal state
 * (fresh install, or the plugin installed before any login) and must not be an
 * error: the caller simply has nothing to meter.
 * @returns the parsed store, or an empty object when unreadable.
 */
export async function loadAuthStore() {
  let raw;
  try {
    raw = await readFile(authFilePath(), 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The sessions of one provider, newest format first.
 *
 * Two on-disk shapes exist: the current `{ accounts: { key: session }, default }`
 * and the pre-multi-account flat one where the session fields sit directly on
 * the provider entry. dsh-plugin-subscriptions migrates the legacy shape in
 * memory on read, so a store written by an older version still has live logins
 * in it; this mirrors that tolerance.
 * @param store - the parsed auth file.
 * @param provider - provider id.
 * @returns account key/session pairs, the default account first.
 */
export function accountsOf(store, provider) {
  const entry = store?.[provider];
  if (typeof entry !== 'object' || entry === null) return [];

  const accounts = entry.accounts;
  if (typeof accounts === 'object' && accounts !== null) {
    const pairs = Object.entries(accounts).filter(
      ([, session]) => typeof session === 'object' && session !== null,
    );
    const preferred = typeof entry.default === 'string' ? entry.default : undefined;
    pairs.sort(([a], [b]) => {
      if (a === preferred) return -1;
      if (b === preferred) return 1;
      return 0;
    });
    return pairs.map(([key, session]) => ({ key, session }));
  }

  // Legacy flat shape.
  if (typeof entry.accessToken === 'string') {
    return [{ key: entry.emailAddress ?? entry.accountId ?? 'default', session: entry }];
  }
  return [];
}

/** RFC3339 timestamp → epoch ms, or undefined. */
function instantFrom(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Whether a reported duration approximately matches an expected window length. */
function matchesWindow(seconds, expected) {
  return seconds >= expected * 0.95 && seconds <= expected * 1.05;
}

/**
 * Map claude's modern `limits` array into normalized windows.
 *
 * `weekly_all` / `weekly_scoped` both mean a 7-day lane; the scope (e.g. Opus)
 * is carried through for the human-readable pause reason only. An entry whose
 * `percent` is not a finite number is skipped rather than treated as zero.
 */
function claudeModernWindows(value) {
  if (!Array.isArray(value)) return [];
  const windows = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    if (typeof raw.percent !== 'number' || !Number.isFinite(raw.percent)) continue;
    const kind =
      raw.kind === 'session'
        ? 'session'
        : raw.kind === 'weekly_all' || raw.kind === 'weekly_scoped'
          ? 'weekly'
          : raw.kind === 'monthly'
            ? 'monthly'
            : 'other';
    const scope = raw.scope?.model?.display_name;
    windows.push({
      kind,
      ...(typeof scope === 'string' && scope.length > 0 ? { scope } : {}),
      usedPercent: raw.percent,
      ...(instantFrom(raw.resets_at) === undefined
        ? {}
        : { resetsAt: instantFrom(raw.resets_at) }),
    });
  }
  return windows;
}

/** Map one legacy claude `{utilization, resets_at}` bucket. */
function claudeLegacyWindow(value, kind, scope) {
  if (typeof value !== 'object' || value === null) return undefined;
  if (typeof value.utilization !== 'number' || !Number.isFinite(value.utilization)) {
    return undefined;
  }
  const resetsAt = instantFrom(value.resets_at);
  return {
    kind,
    ...(scope === undefined ? {} : { scope }),
    usedPercent: value.utilization,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

/**
 * Fetch claude subscription usage.
 * @param session - stored session, used as-is (never refreshed here).
 * @param signal - caller cancellation.
 * @returns normalized usage; `supported: false` is never returned for claude.
 * @throws when the endpoint refuses (401 means the token needs a refresh).
 */
export async function fetchClaudeUsage(session, signal) {
  const response = await fetch(CLAUDE_USAGE_URL, {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'user-agent': 'claude-cli/2.0.0 (external, cli)',
      accept: 'application/json',
    },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    const error = new Error(`claude usage: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();

  const modern = claudeModernWindows(payload.limits);
  if (modern.length > 0) return { supported: true, windows: modern };

  const windows = [];
  for (const window of [
    claudeLegacyWindow(payload.five_hour, 'session'),
    claudeLegacyWindow(payload.seven_day, 'weekly'),
    claudeLegacyWindow(payload.seven_day_opus, 'weekly', 'Opus'),
    claudeLegacyWindow(payload.seven_day_sonnet, 'weekly', 'Sonnet'),
  ]) {
    if (window !== undefined) windows.push(window);
  }
  return { supported: true, windows };
}

/**
 * Classify a codex window by its reported duration.
 *
 * Duration wins over slot position because the backend has been observed to
 * report the weekly lane in `primary_window` with no secondary window; slot
 * order is only the fallback when the duration is missing.
 */
function codexWindowKind(window, fallback) {
  const seconds = window.limit_window_seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return fallback;
  if (matchesWindow(seconds, SESSION_WINDOW_SECONDS)) return 'session';
  if (matchesWindow(seconds, WEEKLY_WINDOW_SECONDS)) return 'weekly';
  if (seconds >= MONTHLY_WINDOW_SECONDS_MIN && seconds <= MONTHLY_WINDOW_SECONDS_MAX) {
    return 'monthly';
  }
  return 'other';
}

/** Map one wham/usage window; undefined when it carries no usable percentage. */
function codexUsageWindow(value, fallbackKind) {
  if (typeof value !== 'object' || value === null) return undefined;
  if (typeof value.used_percent !== 'number' || !Number.isFinite(value.used_percent)) {
    return undefined;
  }
  let resetsAt;
  if (typeof value.reset_at === 'number' && value.reset_at > 0) {
    resetsAt = value.reset_at * 1000;
  } else if (
    typeof value.reset_after_seconds === 'number' &&
    value.reset_after_seconds > 0
  ) {
    resetsAt = Date.now() + value.reset_after_seconds * 1000;
  }
  return {
    kind: codexWindowKind(value, fallbackKind),
    usedPercent: value.used_percent,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

/**
 * Fetch codex subscription usage. The lookup itself consumes no rate-limit budget.
 * @param session - stored session, used as-is.
 * @param signal - caller cancellation.
 * @returns normalized usage.
 * @throws when the endpoint refuses.
 */
export async function fetchCodexUsage(session, signal) {
  const response = await fetch(CODEX_USAGE_URL, {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'chatgpt-account-id': session.accountId ?? '',
      originator: 'codex_cli_rs',
      accept: 'application/json',
    },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    const error = new Error(`codex usage: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();

  const windows = [];
  const primary = codexUsageWindow(payload.rate_limit?.primary_window, 'session');
  const secondary = codexUsageWindow(payload.rate_limit?.secondary_window, 'weekly');
  if (primary !== undefined) windows.push(primary);
  if (secondary !== undefined) windows.push(secondary);

  // Some plans report a third, longer lane; accept it under any of the names
  // the backend has used rather than silently ignoring a real limit.
  for (const key of ['tertiary_window', 'monthly_window', 'secondary_window_2']) {
    const extra = codexUsageWindow(payload.rate_limit?.[key], 'monthly');
    if (extra !== undefined) windows.push(extra);
  }

  return {
    supported: true,
    windows,
    ...(typeof payload.plan_type === 'string' && payload.plan_type.length > 0
      ? { plan: payload.plan_type }
      : {}),
  };
}

/**
 * Fetch usage for one provider account.
 * @param provider - `claude` or `codex`.
 * @param session - the stored session.
 * @param signal - caller cancellation.
 * @returns normalized usage, or `{ supported: false }` for an unmetered provider.
 */
export async function fetchUsage(provider, session, signal) {
  if (provider === 'claude') return fetchClaudeUsage(session, signal);
  if (provider === 'codex') return fetchCodexUsage(session, signal);
  return { supported: false };
}

/** Human-readable name of one window, for log lines and the pause reason. */
export function describeWindow(window) {
  const base =
    window.kind === 'session'
      ? '5-hour'
      : window.kind === 'weekly'
        ? 'weekly'
        : window.kind === 'monthly'
          ? 'monthly'
          : 'usage';
  return window.scope === undefined ? base : `${base} (${window.scope})`;
}
