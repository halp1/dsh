/**
 * Shares "read" between windows. DSH tracks the sidebar's finished-response
 * dot (`completionUnread`) separately in each window, and clears it only when
 * a session is shown in that window's main view. A chat read in the mini window
 * therefore stays unread in the main window.
 *
 * The mini window reports each finished session it displays to the host; the
 * main window clears the dot for sessions the mini window showed after they
 * finished. Clearing uses ui-session's status store, which has no public
 * acknowledge API, so every access is guarded and degrades to a no-op.
 */

/** Allowance for the two windows observing the same stop a moment apart. */
export const VIEW_SKEW_MS = 1500

/** The part of ui-session's service this module touches. */
export interface StatusStore {
  sessionStatus: {
    getSnapshot(): ReadonlyMap<string, { completionUnread: boolean }>
    subscribe(listener: () => void): () => void
  }
}
interface MutableStatus { completionUnread?: Set<string>; publishStatus?: () => void }

/**
 * Sessions whose unread dot the mini window has already seen.
 * A session counts as read when the mini window showed it after this window
 * first saw it unread, or after the session's last recorded activity (which
 * covers a main window reloaded after the response finished).
 * @param unreadSince - local time each currently-unread session was first seen unread.
 * @param viewed - host time the mini window last showed each finished session.
 * @param updatedAt - last activity time per session, when known.
 * @returns ids to clear.
 */
export function readInMini(unreadSince: ReadonlyMap<string, number>, viewed: Readonly<Record<string, number>> | undefined, updatedAt: (id: string) => number | undefined = () => undefined): string[] {
  if (!viewed) return []
  const ids: string[] = []
  for (const [id, since] of unreadSince) {
    const at = viewed[id]
    if (typeof at !== 'number') continue
    const activity = updatedAt(id)
    if (at >= since - VIEW_SKEW_MS || (typeof activity === 'number' && at >= activity - VIEW_SKEW_MS)) ids.push(id)
  }
  return ids
}

/**
 * Keep the main window's unread dots in step with the mini window.
 * @param status - ui-session's service.
 * @param viewed - current mini-window viewed stamps.
 * @param subscribeViewed - change notifications for those stamps.
 * @param updatedAt - last activity time per session, when known.
 * @param now - clock (injectable for tests).
 * @returns disposer.
 */
export function syncReadState(status: StatusStore, viewed: () => Readonly<Record<string, number>> | undefined, subscribeViewed: (listener: () => void) => () => void, updatedAt: (id: string) => number | undefined = () => undefined, now: () => number = Date.now): () => void {
  const unreadSince = new Map<string, number>()
  const reconcile = () => {
    let snapshot: ReadonlyMap<string, { completionUnread: boolean }>
    try { snapshot = status.sessionStatus.getSnapshot() } catch { return }
    for (const id of [...unreadSince.keys()]) if (!snapshot.get(id)?.completionUnread) unreadSince.delete(id)
    for (const [id, value] of snapshot) if (value.completionUnread && !unreadSince.has(id)) unreadSince.set(id, now())
    const clear = readInMini(unreadSince, viewed(), updatedAt)
    if (!clear.length) return
    const store = status as unknown as MutableStatus
    if (!(store.completionUnread instanceof Set) || typeof store.publishStatus !== 'function') return
    for (const id of clear) { store.completionUnread.delete(id); unreadSince.delete(id) }
    try { store.publishStatus() } catch {}
  }
  const offStatus = status.sessionStatus.subscribe(reconcile)
  const offViewed = subscribeViewed(reconcile)
  reconcile()
  return () => { offStatus(); offViewed() }
}
