/**
 * Newest-first session order inside every sidebar folder.
 *
 * The sidebar's "Order by" menu has two modes. "Last updated" ranks each
 * folder by `updatedAt` (the latest prompt), and "Manual" follows a saved
 * browser-local order. Dragging any row silently switches to Manual, after
 * which new tasks stop rising to the top.
 *
 * While enabled, this module masks the ui-workspace view store so `orderBy`
 * reads as `'updated'`. The sidebar then does its own recency sort in every
 * folder (pinned rows and the open New Session still lead), and its Manual
 * order sync effects stay idle. The saved state is never written, so turning
 * the setting off brings the Manual arrangement back.
 */

import type { RecencySettings } from './settings.ts'
import type { PatchableSource } from './sorter.ts'

/** The ui-workspace view-store fields this module reads or rewrites. */
export interface ViewStateLike {
  readonly orderBy?: string
}

/** The sidebar's recency mode. */
export const RECENCY_ORDER = 'updated'

/** A running mask: whether it applies, forced refresh, and teardown. */
export interface SessionOrderer {
  /** True while the sidebar is shown in recency order on top of a different saved mode. */
  readonly masking: boolean
  refresh(): void
  dispose(): void
}

/**
 * Patch the view store so the sidebar always reads recency order.
 * @param view - the ui-workspace view store instance (patched in place).
 * @param getSettings - reads the live settings on each evaluation.
 * @returns the handle.
 */
export function installSessionOrder(
  view: PatchableSource<ViewStateLike>,
  getSettings: () => RecencySettings,
): SessionOrderer {
  const ownGetSnapshot = view.getSnapshot
  if (typeof ownGetSnapshot !== 'function' || typeof view.subscribe !== 'function') {
    throw new TypeError('workspace-recency: the view store must expose getSnapshot and subscribe')
  }
  const baseGetSnapshot = ownGetSnapshot.bind(view)
  const hadOwnGetSnapshot = Object.hasOwn(view, 'getSnapshot')

  let cachedBase: ViewStateLike | undefined
  let cachedResult: ViewStateLike | undefined

  const active = (): boolean => {
    const settings = getSettings()
    return settings.enabled && settings.sortSessions
  }

  // useSyncExternalStore needs a stable identity per upstream snapshot.
  const getSnapshot = (): ViewStateLike => {
    const base = baseGetSnapshot()
    if (!active() || base.orderBy === RECENCY_ORDER) return base
    if (cachedBase !== base || cachedResult === undefined) {
      cachedBase = base
      cachedResult = { ...base, orderBy: RECENCY_ORDER }
    }
    return cachedResult
  }

  view.getSnapshot = getSnapshot

  // The store only notifies on a real change. A shallow copy is a new identity
  // with identical content, so zustand notifies and the persisted JSON is unchanged.
  const wake = (): void => {
    const store = (view as { store?: { set?: (next: unknown) => void } }).store
    if (typeof store?.set === 'function') store.set({ ...baseGetSnapshot() })
  }

  if (getSnapshot() !== baseGetSnapshot()) wake()

  return {
    get masking() { return getSnapshot() !== baseGetSnapshot() },
    refresh: wake,
    dispose: () => {
      if (hadOwnGetSnapshot) view.getSnapshot = baseGetSnapshot
      else delete view.getSnapshot
      wake()
    },
  }
}
