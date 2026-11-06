/**
 * Per-device sort preferences.
 *
 * These live in localStorage rather than the Host settings document because
 * the sort is a *view* over host state, not a change to it: the same profile
 * opened from a second browser is free to keep the manual order. Every read is
 * defensive — a corrupt or partial value falls back to the default rather than
 * breaking boot.
 */

/** localStorage key holding the serialized {@link RecencySettings}. */
export const RECENCY_SETTINGS_KEY = 'dsh.workspaceRecency.settings'

/** Everything the user can tune about the ordering. */
export interface RecencySettings {
  /** Master switch; false restores the host's manual order untouched. */
  enabled: boolean
  /** Keep the folder holding the current session pinned to the top. */
  pinCurrent: boolean
  /** Order sessions inside Ungrouped newest first, even in the sidebar's Manual mode. */
  sortUngroupedSessions: boolean
  /** Move the Ungrouped folder to its activity rank instead of always last. */
  moveUngroupedFolder: boolean
}

/** Sorting on everywhere, current folder not pinned. */
export const DEFAULT_SETTINGS: RecencySettings = {
  enabled: true,
  pinCurrent: false,
  sortUngroupedSessions: true,
  moveUngroupedFolder: true,
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
export function normalizeSettings(value: unknown): RecencySettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS }
  const raw = value as Partial<Record<keyof RecencySettings, unknown>>
  const pick = (key: keyof RecencySettings): boolean =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : DEFAULT_SETTINGS[key]
  return {
    enabled: pick('enabled'),
    pinCurrent: pick('pinCurrent'),
    sortUngroupedSessions: pick('sortUngroupedSessions'),
    moveUngroupedFolder: pick('moveUngroupedFolder'),
  }
}

/**
 * Read the persisted settings.
 * @param storage - localStorage, or undefined where it is unavailable.
 * @returns the stored settings, or the defaults.
 */
export function loadSettings(storage: SettingsStorage | undefined): RecencySettings {
  if (storage === undefined) return { ...DEFAULT_SETTINGS }
  try {
    const raw = storage.getItem(RECENCY_SETTINGS_KEY)
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
export function saveSettings(storage: SettingsStorage | undefined, settings: RecencySettings): void {
  if (storage === undefined) return
  try {
    storage.setItem(RECENCY_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage refused the write; the in-memory settings remain authoritative
    // for this page load.
  }
}
