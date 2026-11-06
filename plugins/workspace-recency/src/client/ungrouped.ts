/**
 * Newest-first order for the sessions inside the sidebar's Ungrouped folder.
 *
 * The sidebar has two session orders, picked in its "Order by" menu:
 *
 *  - **Last updated** — every folder, Ungrouped included, is already sorted
 *    newest first. Nothing to do.
 *  - **Manual** — every folder follows a saved browser-local order kept in the
 *    ui-workspace view store (`sessionOrderByAccount`, where Ungrouped is the
 *    `""` account). Dragging any session switches the sidebar to this mode,
 *    so it is easy to land in it without meaning to.
 *
 * In manual mode this module masks only the Ungrouped account with a
 * newest-first order. Workspace folders keep their manual order.
 *
 * The seam is the view store instance itself. ui-workspace creates one
 * instance and registers it as the `store` of its `sidebar.workspaces` slot
 * entry, and the renderer binds the sidebar's `useStore` hook to that object
 * with dynamic `getSnapshot()` dispatch. Shadowing `getSnapshot`/`subscribe`
 * on the instance therefore reroutes the sidebar's reads, and restoring them
 * undoes it exactly. The stored manual order is never overwritten by this
 * module; turn the feature off and the saved order is still there.
 */

import { currentBlankSessionId, ungroupedSessionIds, type SessionIndex, type SessionListLike } from './activity.ts'
import type { RecencySettings } from './settings.ts'
import type { PatchableSource, Source, WorkspaceSnapshotLike } from './sorter.ts'

/** The ui-workspace view-store fields this module reads or rewrites. */
export interface ViewStateLike {
  readonly orderBy?: string
  readonly sessionOrderByAccount?: Readonly<Record<string, readonly string[]>>
}

/** The view store's account key for the Ungrouped folder. */
export const UNGROUPED_ACCOUNT = ''

/**
 * Order session ids newest first, the way the sidebar's own "Last updated"
 * mode does: by `updatedAt` descending, ties broken by id.
 * @param ids - the sessions to order.
 * @param byId - session rows; ids without a row are dropped.
 * @returns ordered ids.
 */
export function orderByRecency(ids: readonly string[], byId: SessionIndex): string[] {
  const known: { id: string, at: number }[] = []
  for (const id of ids) {
    const session = byId[id]
    if (session !== undefined) known.push({ id, at: session.updatedAt })
  }
  known.sort((a, b) => {
    if (a.at !== b.at) return b.at - a.at
    return a.id < b.id ? -1 : 1
  })
  return known.map(entry => entry.id)
}

/**
 * The Ungrouped order the sidebar should render in manual mode.
 *
 * The open blank New Session row (when it is ungrouped) leads, because the
 * sidebar pins it first and re-saves the order until the saved order agrees.
 * Leading with it keeps that sync settled instead of looping.
 * @param items - workspace rows.
 * @param list - the session list snapshot.
 * @returns ordered Ungrouped session ids.
 */
export function ungroupedRecencyOrder(items: WorkspaceSnapshotLike['items'], list: SessionListLike): string[] {
  const members = ungroupedSessionIds(items, list)
  const ordered = orderByRecency(members, list.byId)
  const blank = currentBlankSessionId(list)
  if (blank === undefined || !members.includes(blank)) return ordered
  return [blank, ...ordered.filter(id => id !== blank)]
}

/** Same ids in the same order. */
function sameIds(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (left === undefined) return false
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

/** Everything {@link installUngroupedSessionOrder} binds to. */
export interface UngroupedSources {
  /** The ui-workspace view store instance (patched in place). */
  view: PatchableSource<ViewStateLike>
  /** The workspace source (read-only here). */
  workspaces: Source<WorkspaceSnapshotLike>
  /** The session list (read-only). */
  sessions: Source<SessionListLike>
}

/** A running mask: forced refresh and teardown. */
export interface UngroupedOrderer {
  /** The Ungrouped order the sidebar currently renders in manual mode, or undefined when the mask is off. */
  readonly order: readonly string[] | undefined
  /** Re-evaluate and wake the sidebar (used when a setting changed). */
  refresh(): void
  /** Restore the untouched view store. */
  dispose(): void
}

/**
 * Patch the view store so the Ungrouped account reads newest first while the
 * sidebar is in manual order.
 * @param sources - the view store to patch plus the data it ranks by.
 * @param getSettings - reads the live settings on each evaluation.
 * @returns the handle.
 */
export function installUngroupedSessionOrder(
  sources: UngroupedSources,
  getSettings: () => RecencySettings,
): UngroupedOrderer {
  const { view, workspaces, sessions } = sources

  const ownGetSnapshot = view.getSnapshot
  const ownSubscribe = view.subscribe
  if (typeof ownGetSnapshot !== 'function' || typeof ownSubscribe !== 'function') {
    throw new TypeError('workspace-recency: the view store must expose getSnapshot and subscribe')
  }
  const baseGetSnapshot = ownGetSnapshot.bind(view)
  const baseSubscribe = ownSubscribe.bind(view)
  const hadOwnGetSnapshot = Object.hasOwn(view, 'getSnapshot')
  const hadOwnSubscribe = Object.hasOwn(view, 'subscribe')

  let cachedBase: ViewStateLike | undefined
  let cachedResult: ViewStateLike | undefined
  let settingsRevision = 0
  let cachedRevision = -1

  /**
   * The order to mask with, or undefined when the mask should be off.
   * @param base - the real view state.
   * @returns the Ungrouped order, or undefined.
   */
  const maskOrder = (base: ViewStateLike): string[] | undefined => {
    const settings = getSettings()
    if (!settings.enabled || !settings.sortUngroupedSessions) return undefined
    if (base.orderBy !== 'manual') return undefined
    return ungroupedRecencyOrder(workspaces.getSnapshot().items, sessions.getSnapshot())
  }

  const getSnapshot = (): ViewStateLike => {
    const base = baseGetSnapshot()
    const order = maskOrder(base)
    if (order === undefined) {
      cachedBase = base
      cachedRevision = settingsRevision
      cachedResult = base
      return base
    }
    const cachedOrder = cachedResult?.sessionOrderByAccount?.[UNGROUPED_ACCOUNT]
    if (
      cachedResult !== undefined
      && cachedBase === base
      && cachedRevision === settingsRevision
      && sameIds(cachedOrder, order)
    ) return cachedResult
    cachedBase = base
    cachedRevision = settingsRevision
    // Already in the right order: hand back the real object so identity holds.
    cachedResult = sameIds(base.sessionOrderByAccount?.[UNGROUPED_ACCOUNT], order)
      ? base
      : { ...base, sessionOrderByAccount: { ...base.sessionOrderByAccount, [UNGROUPED_ACCOUNT]: order } }
    return cachedResult
  }

  /** The masked Ungrouped order a consumer last saw. */
  const visibleOrder = (): readonly string[] | undefined =>
    getSnapshot().sessionOrderByAccount?.[UNGROUPED_ACCOUNT]

  const bridges = new Set<() => void>()

  /**
   * Store changes pass through; session and workspace changes wake the
   * consumer only when they move something inside Ungrouped.
   * @param listener - the consumer's invalidation callback.
   * @returns unsubscribe.
   */
  const subscribe = (listener: () => void): (() => void) => {
    let last = visibleOrder()
    const disposeView = baseSubscribe(() => {
      last = visibleOrder()
      listener()
    })
    const onData = (): void => {
      const next = visibleOrder()
      if (next === last || (next !== undefined && sameIds(last, next))) return
      last = next
      listener()
    }
    const disposeSessions = sessions.subscribe(onData)
    const disposeWorkspaces = workspaces.subscribe(onData)
    const dropBridge = (): void => {
      if (!bridges.delete(dropBridge)) return
      disposeSessions()
      disposeWorkspaces()
    }
    bridges.add(dropBridge)
    return () => {
      disposeView()
      dropBridge()
    }
  }

  view.getSnapshot = getSnapshot
  view.subscribe = subscribe

  /**
   * Wake the store's own subscribers. The view store notifies only on a real
   * state change, which a setting flip is not. The underlying snapshot store
   * (zustand) skips a `set` of the identical object, so it gets a shallow copy:
   * same content, new identity. The persisted JSON is unchanged.
   */
  const wake = (): void => {
    const store = (view as { store?: { set?: (next: unknown) => void } }).store
    if (typeof store?.set === 'function') store.set({ ...baseGetSnapshot() })
  }

  // A sidebar that rendered before this plugin loaded holds the old order and
  // has no reason to re-read; wake it when the mask changes what it shows.
  if (getSnapshot() !== baseGetSnapshot()) wake()

  return {
    get order() {
      const base = baseGetSnapshot()
      return maskOrder(base) === undefined ? undefined : visibleOrder()
    },
    refresh: () => {
      settingsRevision += 1
      wake()
    },
    dispose: () => {
      for (const dropBridge of [...bridges]) dropBridge()
      if (hadOwnGetSnapshot) view.getSnapshot = baseGetSnapshot
      else delete view.getSnapshot
      if (hadOwnSubscribe) view.subscribe = baseSubscribe
      else delete view.subscribe
      wake()
    },
  }
}
