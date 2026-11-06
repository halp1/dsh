/**
 * Most-recently-opened sessions, newest first, kept per device.
 *
 * The host knows when a session last changed, which is not the same as when
 * you last looked at it. This list records the latter so Cmd+K then Enter
 * returns to the session you came from.
 * @module
 */

/** localStorage key. */
export const RECENT_KEY = 'dsh.quickswitcher.recent'

/** Entries kept. */
export const RECENT_LIMIT = 50

/** Minimal storage face, so tests need no DOM. */
export interface RecentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The recent list. */
export interface Recent {
  /** Move a session to the front. */
  push(sessionId: string): void
  /** Session ids, most recent first. */
  list(): readonly string[]
}

/**
 * Parse a stored value, discarding anything that is not a list of strings.
 * @param raw - stored text, or null.
 * @returns ids, deduplicated and capped.
 */
function parse(raw: string | null): string[] {
  if (raw === null) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const ids = value.filter((id): id is string => typeof id === 'string' && id !== '')
    return [...new Set(ids)].slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

/**
 * Open the recent list.
 * @param storage - localStorage, or undefined where it is unavailable.
 * @returns the list. Storage failures leave it working in memory.
 */
export function createRecent(storage: RecentStorage | undefined): Recent {
  let ids: string[]
  try {
    ids = parse(storage?.getItem(RECENT_KEY) ?? null)
  } catch {
    ids = []
  }
  return {
    push(sessionId) {
      if (ids[0] === sessionId) return
      ids = [sessionId, ...ids.filter(id => id !== sessionId)].slice(0, RECENT_LIMIT)
      try {
        storage?.setItem(RECENT_KEY, JSON.stringify(ids))
      } catch {
        // Quota or a sandboxed frame: the in-memory list stays authoritative.
      }
    },
    list: () => ids,
  }
}
