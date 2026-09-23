/**
 * Per-device badge preferences.
 *
 * These live in localStorage rather than the Host settings document on
 * purpose: whether a badge is visible at all depends on whether *this* browser
 * installed the PWA, so the same profile viewed from an installed app and from
 * an ordinary tab wants different answers (the tab wants the title mirror, the
 * app does not). Every read is defensive — a corrupt or partial value falls
 * back to the default rather than breaking boot.
 */

import { DEFAULT_COUNT_OPTIONS, type BadgeCountOptions } from './count.ts'
import { DEFAULT_APPLIER_OPTIONS, type BadgeApplierOptions } from './badge.ts'

/** localStorage key holding the serialized {@link BadgeSettings}. */
export const BADGE_SETTINGS_KEY = 'dsh.badge.settings'

/** Everything the user can tune about the badge. */
export interface BadgeSettings extends BadgeCountOptions, BadgeApplierOptions {
  /** Master switch; false clears the badge and stops publishing. */
  enabled: boolean
}

/** Badge on, counting attention + completed, no title mirror. */
export const DEFAULT_SETTINGS: BadgeSettings = {
  enabled: true,
  ...DEFAULT_COUNT_OPTIONS,
  ...DEFAULT_APPLIER_OPTIONS,
}

/** Minimal storage face, so tests need no DOM. */
export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Coerce an unknown parsed value into complete settings, filling every missing
 * or wrongly-typed field from the defaults.
 * @param value - the raw parsed JSON.
 * @returns complete, valid settings.
 */
export function normalizeSettings(value: unknown): BadgeSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS }
  const raw = value as Partial<Record<keyof BadgeSettings, unknown>>
  const pick = (key: keyof BadgeSettings): boolean =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : DEFAULT_SETTINGS[key]
  return {
    enabled: pick('enabled'),
    countCompleted: pick('countCompleted'),
    countAttention: pick('countAttention'),
    countRunning: pick('countRunning'),
    mirrorTitle: pick('mirrorTitle'),
  }
}

/**
 * Read the persisted settings.
 * @param storage - localStorage, or undefined where it is unavailable.
 * @returns the stored settings, or the defaults.
 */
export function loadSettings(storage: SettingsStorage | undefined): BadgeSettings {
  if (storage === undefined) return { ...DEFAULT_SETTINGS }
  try {
    const raw = storage.getItem(BADGE_SETTINGS_KEY)
    if (raw === null) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    // Unavailable (private mode / sandboxed iframe) or corrupt: use defaults.
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Persist settings, ignoring storage failures.
 * @param storage - localStorage, or undefined where it is unavailable.
 * @param settings - the complete settings to write.
 */
export function saveSettings(storage: SettingsStorage | undefined, settings: BadgeSettings): void {
  if (storage === undefined) return
  try {
    storage.setItem(BADGE_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage refused the write; the in-memory settings remain authoritative
    // for this page load.
  }
}
