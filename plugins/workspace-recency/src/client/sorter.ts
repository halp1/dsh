/**
 * The live wiring: wrap the Workspace Controller's snapshot source so every
 * consumer sees workspaces in activity order.
 *
 * Why patch the source object rather than register a competing one: the
 * sidebar reads workspaces through the `useWorkspaces` root standard hook,
 * which ui-workspace publishes once at apply time with
 * `slots.provideRoot({ hooks: { workspaces: workspaces.list } })`. Root hook
 * names must be globally unique — a second contribution under the same name
 * throws `duplicate root standard hook` and takes boot down — so a plugin
 * cannot re-provide it. What a plugin *can* do is decorate the very object
 * that contribution captured: `workspaces.list` is the ClientWorkspaceModel
 * instance, `getSnapshot`/`subscribe` live on its prototype, and React reads
 * them through dynamic dispatch on each call. Shadowing them with own
 * properties therefore reroutes every existing and future reader, no matter
 * which plugin loaded first, and `delete` restores the originals exactly.
 *
 * Two invariants this file exists to protect:
 *
 *  - **Identity stability.** `useSyncExternalStore` tears or loops forever if
 *    `getSnapshot()` returns a fresh object each call, so the wrapper caches
 *    its result and returns the identical reference until the order, the
 *    upstream snapshot, or the settings actually change.
 *  - **Notification honesty.** Session snapshots invalidate on every stream
 *    frame, but almost none of those frames reorder anything. The wrapper
 *    forwards a session-driven wake-up only when the resulting order differs,
 *    so typing in a chat does not re-render the sidebar tree.
 */

import {
  mainSessionId,
  sameOrder,
  sortWorkspaces,
  workspaceOfSession,
  type SessionListLike,
  type WorkspaceLike,
} from './activity.ts'
import type { RecencySettings } from './settings.ts'

/** The read/subscribe shape both host sources satisfy. */
export interface Source<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** The workspace snapshot fields this plugin reads or rewrites. */
export interface WorkspaceSnapshotLike {
  readonly items: readonly WorkspaceLike[]
  readonly archivedSessionIds: readonly string[]
}

export type { SessionListLike } from './activity.ts'

/**
 * A source whose read/subscribe methods can be shadowed by own properties.
 *
 * The methods are declared optional because the patch installs them as own
 * properties and `delete`s them again on teardown, falling back to the
 * prototype implementations underneath. That is exactly what an optional
 * property means here — absent from the instance, not absent from the object.
 */
export type PatchableSource<T> = {
  getSnapshot?: () => T
  subscribe?: (listener: () => void) => () => void
}

/** Everything {@link installRecencySort} binds to. */
export interface SorterSources {
  /** The Workspace Controller's snapshot model (patched in place). */
  workspaces: PatchableSource<WorkspaceSnapshotLike>
  /** The Session Controller's list (read-only). */
  sessions: Source<SessionListLike>
}

/** A running sort: the current order, a forced refresh, and teardown. */
export interface RecencySorter {
  /** Workspace ids in the order the sidebar currently renders them. */
  readonly order: readonly string[]
  /** Re-evaluate and wake consumers now (used when a setting changed). */
  refresh(): void
  /** Restore the untouched host source. */
  dispose(): void
}

/**
 * Patch the workspace source so its snapshot lists workspaces newest-active
 * first, and keep it in sync with session activity.
 * @param sources - the workspace model to patch and the session list to read.
 * @param getSettings - reads the live settings on each evaluation.
 * @returns the sorter handle.
 */
export function installRecencySort(
  sources: SorterSources,
  getSettings: () => RecencySettings,
): RecencySorter {
  const { workspaces, sessions } = sources

  // Captured before patching so teardown and the wrapper itself always reach
  // the genuine implementations rather than recursing into the patch. A source
  // missing either method is a wiring mistake worth failing loudly on, since
  // the alternative is a silently unsorted sidebar.
  const ownGetSnapshot = workspaces.getSnapshot
  const ownSubscribe = workspaces.subscribe
  if (typeof ownGetSnapshot !== 'function' || typeof ownSubscribe !== 'function') {
    throw new TypeError('workspace-recency: the workspace source must expose getSnapshot and subscribe')
  }
  const baseGetSnapshot = ownGetSnapshot.bind(workspaces)
  const baseSubscribe = ownSubscribe.bind(workspaces)
  const hadOwnGetSnapshot = Object.hasOwn(workspaces, 'getSnapshot')
  const hadOwnSubscribe = Object.hasOwn(workspaces, 'subscribe')

  /** Last upstream snapshot the cache was built from. */
  let cachedBase: WorkspaceSnapshotLike | undefined
  /** The object handed to React; reused until something really changes. */
  let cachedResult: WorkspaceSnapshotLike | undefined
  /** Bumped by {@link refresh} so a settings change invalidates the cache. */
  let settingsRevision = 0
  let cachedRevision = -1

  /**
   * Order the current workspaces under the live settings.
   * @param base - the upstream snapshot.
   * @returns the ordered rows (the upstream array itself when sorting is off).
   */
  const order = (base: WorkspaceSnapshotLike): readonly WorkspaceLike[] => {
    const settings = getSettings()
    if (!settings.enabled) return base.items
    const list = sessions.getSnapshot()
    return sortWorkspaces(base.items, {
      sessions: list.byId,
      archived: new Set(base.archivedSessionIds),
      currentWorkspaceId: workspaceOfSession(base.items, mainSessionId(list)),
      pinCurrent: settings.pinCurrent,
    })
  }

  /**
   * The patched read: same shape, reordered items, stable identity.
   * @returns the workspace snapshot consumers should render.
   */
  const getSnapshot = (): WorkspaceSnapshotLike => {
    const base = baseGetSnapshot()
    const ranked = order(base)
    if (
      cachedResult !== undefined
      && cachedBase === base
      && cachedRevision === settingsRevision
      && sameOrder(cachedResult.items, ranked)
    ) return cachedResult
    cachedBase = base
    cachedRevision = settingsRevision
    // Identical order: hand back the upstream object untouched so consumers
    // comparing snapshot identity across a no-op frame still see no change.
    cachedResult = sameOrder(base.items, ranked) ? base : { ...base, items: ranked }
    return cachedResult
  }

  /**
   * Session-bridge teardowns, one per live consumer. Held here because plugin
   * teardown must drop every bridge even for consumers that never unsubscribe
   * (the sidebar outlives an HMR reload of this plugin); leaving one attached
   * would keep a disposed closure listening to session frames forever.
   */
  const bridges = new Set<() => void>()

  /**
   * The patched subscribe: upstream changes pass through, session changes wake
   * consumers only when they actually reorder the list.
   * @param listener - the consumer's invalidation callback.
   * @returns an unsubscribe for both underlying subscriptions.
   */
  const subscribe = (listener: () => void): (() => void) => {
    // Seeded from the order the listener is about to read, so the first
    // session frame after subscribing compares against what it really sees.
    let lastOrder = getSnapshot().items
    const disposeWorkspaces = baseSubscribe(() => {
      lastOrder = getSnapshot().items
      listener()
    })
    const disposeSessions = sessions.subscribe(() => {
      const next = getSnapshot().items
      if (sameOrder(lastOrder, next)) return
      lastOrder = next
      listener()
    })
    // Idempotent: the consumer may unsubscribe after plugin teardown already
    // dropped the bridge, and a double removal must not disturb the source.
    const dropBridge = (): void => {
      if (!bridges.delete(dropBridge)) return
      disposeSessions()
    }
    bridges.add(dropBridge)
    return () => {
      disposeWorkspaces()
      dropBridge()
    }
  }

  workspaces.getSnapshot = getSnapshot
  workspaces.subscribe = subscribe

  // A sidebar that rendered before this plugin loaded holds the host order and
  // has no reason to re-read; wake it when the sort changes what it shows.
  if (getSnapshot() !== baseGetSnapshot()) notify(workspaces)

  return {
    get order() { return getSnapshot().items.map(workspace => workspace.workspaceId) },
    refresh: () => {
      // Invalidate the identity cache, then wake consumers directly: the host
      // model's own state did not change, so it will not notify them itself.
      settingsRevision += 1
      notify(workspaces)
    },
    dispose: () => {
      for (const dropBridge of [...bridges]) dropBridge()
      if (hadOwnGetSnapshot) workspaces.getSnapshot = baseGetSnapshot
      else delete workspaces.getSnapshot
      if (hadOwnSubscribe) workspaces.subscribe = baseSubscribe
      else delete workspaces.subscribe
      // Consumers are still subscribed to the host model directly; wake them so
      // the restored manual order actually renders.
      notify(workspaces)
    },
  }
}

/**
 * Wake every consumer of a patched source.
 *
 * The model keeps its subscribers in a private `listeners` set and only
 * notifies them when its own state changes — which a settings flip or a
 * teardown does not. Calling them directly is the one way to make the sidebar
 * re-read a snapshot that changed underneath it; a source that does not expose
 * the set simply refreshes on its next natural frame.
 * @param source - the patched workspace model.
 */
function notify(source: PatchableSource<WorkspaceSnapshotLike>): void {
  const listeners = (source as { listeners?: Iterable<() => void> }).listeners
  if (listeners === undefined || typeof (listeners as Iterable<() => void>)[Symbol.iterator] !== 'function') return
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('[workspace-recency] consumer refresh failed:', error)
    }
  }
}
