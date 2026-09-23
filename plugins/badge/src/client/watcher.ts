/**
 * The live wiring: three host sources in, one badge number out.
 *
 * The badge must follow *every* transition that lights a sidebar dot, and those
 * facts are spread across three independent observables:
 *
 *  - `sessions.list` — the `completed` reminder bit and the current selection.
 *  - `workspaces.list` — the archive set, since archiving a finished session
 *    removes its row and therefore its dot.
 *  - `uiSession.pendingInteractions` — approval / plan-review / question, which
 *    are pure browser-side state and never appear in a session summary.
 *
 * All three are plain `{getSnapshot, subscribe}` sources, so the watcher
 * subscribes to each and recomputes on any of them. Recomputation is cheap (one
 * pass over the id list) but the notifications are not rare — session snapshots
 * invalidate on every stream frame — so the publish path is what deduplicates,
 * inside {@link BadgeApplier}.
 */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { countUnread, type BadgeCountOptions } from './count.ts'
import type { BadgeApplier } from './badge.ts'

/** The read/subscribe shape every host source in this file satisfies. */
export interface Source<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Just the archive field this watcher reads from the workspace snapshot. */
export interface ArchiveSnapshot {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Host sources the watcher binds to. */
export interface BadgeSources {
  sessions: Source<SessionListState>
  workspaces: Source<ArchiveSnapshot>
  pendingInteractions: Source<SessionPendingInteractionSnapshot>
}

/** Everything {@link installBadgeWatcher} needs beyond the sources. */
export interface BadgeWatcherOptions {
  /** Publishes counts to the platform. */
  applier: BadgeApplier
  /** Reads the live count options; called per recomputation so settings changes take effect immediately. */
  getOptions: () => BadgeCountOptions & { enabled: boolean }
  /** Notified after each recomputation, for UI that displays the current count. */
  onCount?: (count: number) => void
}

/**
 * Compute the current count from live sources.
 * @param sources - the three host observables.
 * @param options - which dot classes count.
 * @returns the number of unread sidebar items.
 */
export function readCount(sources: BadgeSources, options: BadgeCountOptions): number {
  return countUnread({
    list: sources.sessions.getSnapshot(),
    archivedSessionIds: sources.workspaces.getSnapshot().archivedSessionIds,
    pendingInteractions: sources.pendingInteractions.getSnapshot(),
  }, options)
}

/** A running watcher: the live count, a manual refresh, and teardown. */
export interface BadgeWatcher {
  /** The most recently computed count. */
  readonly count: number
  /**
   * Recompute and publish now, bypassing the applier's unchanged-value guard.
   * Used when a *setting* changed rather than the session state, where the
   * number may be identical but the presentation is not.
   */
  refresh(): void
  /** Unsubscribe from every source and clear the badge. */
  dispose(): void
}

/**
 * Subscribe to the host sources and keep the app badge in sync.
 *
 * Publishes once immediately so a page that loads with three finished sessions
 * badges without waiting for the next state change — and, equally, so a page
 * that loads with nothing pending clears a badge left over from last time.
 * @param sources - the three host observables.
 * @param options - applier, live settings reader, and optional count callback.
 * @returns the watcher handle.
 */
export function installBadgeWatcher(sources: BadgeSources, options: BadgeWatcherOptions): BadgeWatcher {
  const { applier, getOptions, onCount } = options
  let count = 0

  const recompute = (force: boolean): void => {
    const settings = getOptions()
    // Disabled is published as a real 0 rather than skipped: flipping the
    // switch off must take the badge down, not freeze the last value.
    count = settings.enabled ? readCount(sources, settings) : 0
    applier.publish(count, force)
    onCount?.(count)
  }

  const onChange = (): void => { recompute(false) }

  const unsubscribes = [
    sources.sessions.subscribe(onChange),
    sources.workspaces.subscribe(onChange),
    sources.pendingInteractions.subscribe(onChange),
  ]

  recompute(false)

  return {
    get count() { return count },
    refresh: () => { recompute(true) },
    dispose: () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
      // Teardown (plugin disable / HMR reload) must not leave a stale number on
      // an icon that nothing is updating any more.
      applier.reset()
    },
  }
}
