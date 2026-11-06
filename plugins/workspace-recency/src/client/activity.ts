/**
 * The pure ordering core: host state in, workspace order out.
 *
 * Nothing here touches the DOM, cordis, or React — it is a projection from
 * "which sessions live in which workspace, and when did each last change" to
 * "what order should the sidebar's workspace groups render in". Keeping it
 * pure is what makes the ordering rules testable without a browser.
 *
 * The types are structural on purpose: they name only the fields this module
 * reads, so the core compiles and tests without dragging in the controllers'
 * full view types (the client half binds the real ones).
 */

/** The workspace fields the ordering reads. */
export interface WorkspaceLike {
  readonly workspaceId: string
  /** Sessions accounted to this workspace, in the host's manual order. */
  readonly sessionIds: readonly string[]
  /** ISO-8601 creation instant, used as the fallback activity time. */
  readonly createdAt: string
}

/** The session fields the ordering reads. */
export interface SessionLike {
  /** Empty-log bit; a blank row is a placeholder, not activity. */
  readonly blank: boolean
  /** Epoch-ms last-change time — the same field the sidebar sorts sessions by. */
  readonly updatedAt: number
  /** `'subagent'` rows fold into their parent's header and have no sidebar row. */
  readonly origin?: string | undefined
  /**
   * Local reference counts by source (DSH 0.2+). The sidebar treats the
   * session retained by `mainView` as the one currently open.
   */
  readonly retainedBy?: Readonly<Record<string, number | undefined>> | undefined
}

/** Session rows addressed by id, exactly as the Session Controller stores them. */
export type SessionIndex = Readonly<Record<string, SessionLike | undefined>>

/** The session-list fields the ordering reads. */
export interface SessionListLike {
  /** Host list order. */
  readonly ids: readonly string[]
  /** Session rows by id. */
  readonly byId: SessionIndex
  /** Selected session on DSH 0.1; DSH 0.2 derives it from `retainedBy`. */
  readonly current?: string | undefined
}

/** Everything the ordering needs beyond the workspace rows themselves. */
export interface ActivityContext {
  /** Session rows by id. */
  readonly sessions: SessionIndex
  /** Registry-global archive set; archived rows have no sidebar presence. */
  readonly archived: ReadonlySet<string>
}

/** Ordering knobs that change the result rather than the presentation. */
export interface SortOptions extends ActivityContext {
  /** Workspace holding the selected session, when the caller wants it pinned. */
  readonly currentWorkspaceId?: string | undefined
  /** Keep {@link currentWorkspaceId} first regardless of its activity time. */
  readonly pinCurrent?: boolean
}

/** Sorts below every real timestamp without poisoning arithmetic comparisons. */
const NEVER = Number.NEGATIVE_INFINITY

/**
 * The instant a workspace was last active.
 *
 * Activity means "a session you can actually see in this group changed": blank
 * rows (New Session placeholders) and archived rows are skipped, because
 * neither is something the user did work in. A workspace with no qualifying
 * session falls back to its own creation time, so a freshly adopted empty
 * folder lands near the top where the user just put it rather than at the
 * bottom among stale projects.
 * @param workspace - the workspace row.
 * @param context - session rows and the archive set.
 * @returns epoch-ms activity time, or -Infinity when even createdAt is unusable.
 */
export function workspaceActivityAt(workspace: WorkspaceLike, context: ActivityContext): number {
  const latest = sessionsActivityAt(workspace.sessionIds, context)
  if (latest !== NEVER) return latest
  const created = Date.parse(workspace.createdAt)
  return Number.isNaN(created) ? NEVER : created
}

/**
 * The newest activity among a set of sessions.
 *
 * Only rows the user did work in count: blank placeholders, archived rows,
 * and subagent rows (which have no sidebar row of their own) are skipped.
 * @param sessionIds - the sessions to scan.
 * @param context - session rows and the archive set.
 * @returns epoch-ms activity time, or -Infinity when no session qualifies.
 */
export function sessionsActivityAt(sessionIds: Iterable<string>, context: ActivityContext): number {
  let latest = NEVER
  for (const sessionId of sessionIds) {
    const session = context.sessions[sessionId]
    // A membership entry can outlive its row during a reconnect re-pull.
    if (session === undefined) continue
    if (session.blank) continue
    if (session.origin === 'subagent') continue
    if (context.archived.has(sessionId)) continue
    if (session.updatedAt > latest) latest = session.updatedAt
  }
  return latest
}

/**
 * The session currently open in the main view.
 *
 * DSH 0.1 put it on the list as `current`; DSH 0.2 dropped that field and the
 * sidebar now reads it from the session retained by `mainView`. Both are
 * honored so the plugin works on either.
 * @param list - the session list snapshot.
 * @returns the open session id, or undefined when none is open.
 */
export function mainSessionId(list: SessionListLike): string | undefined {
  for (const [id, session] of Object.entries(list.byId)) {
    if ((session?.retainedBy?.['mainView'] ?? 0) > 0) return id
  }
  return list.current
}

/**
 * The open session, when it is a blank New Session placeholder.
 *
 * The sidebar pins this row first in its account; the ungrouped order mask
 * has to agree with that or the sidebar's own order sync never settles.
 * @param list - the session list snapshot.
 * @returns the blank open session id, or undefined.
 */
export function currentBlankSessionId(list: SessionListLike): string | undefined {
  const id = mainSessionId(list)
  if (id === undefined) return undefined
  return list.byId[id]?.blank === true ? id : undefined
}

/**
 * Sessions no workspace accounts for — the sidebar's Ungrouped bucket.
 * @param items - workspace rows.
 * @param list - the session list snapshot.
 * @returns ungrouped session ids in host list order.
 */
export function ungroupedSessionIds(items: readonly WorkspaceLike[], list: SessionListLike): string[] {
  const accounted = new Set<string>()
  for (const workspace of items) {
    for (const id of workspace.sessionIds) accounted.add(id)
  }
  return list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))
}

/** Where the Ungrouped folder belongs among the workspace groups. */
export interface UngroupedPlacement {
  /** Newest activity inside Ungrouped, or -Infinity when it has none. */
  readonly activityAt: number
  /** Workspace ids that render above Ungrouped. */
  readonly before: readonly string[]
  /** True when every workspace renders above it, which is where the sidebar already puts it. */
  readonly last: boolean
}

/** Inputs for {@link placeUngrouped}. */
export interface PlacementOptions extends ActivityContext {
  /** Ungrouped session ids. */
  readonly ungroupedIds: readonly string[]
  /** Workspace holding the open session (undefined when it is ungrouped or none is open). */
  readonly currentWorkspaceId?: string | undefined
  /** True when the open session sits in Ungrouped. */
  readonly currentInUngrouped?: boolean
  /** Mirror of the workspace `pinCurrent` setting. */
  readonly pinCurrent?: boolean
}

/**
 * Rank the Ungrouped folder against the workspaces.
 *
 * Ungrouped is treated like one more workspace whose activity is its newest
 * session. Ties go to the workspace, matching the sidebar's habit of
 * putting Ungrouped last. With `pinCurrent`, the folder holding the open
 * session stays on top, whichever kind of folder it is.
 * @param items - workspace rows (any order).
 * @param options - session state, Ungrouped membership, and pinning.
 * @returns the workspaces that precede Ungrouped.
 */
export function placeUngrouped(items: readonly WorkspaceLike[], options: PlacementOptions): UngroupedPlacement {
  const activityAt = sessionsActivityAt(options.ungroupedIds, options)
  if (options.pinCurrent === true && options.currentInUngrouped === true) {
    return { activityAt, before: [], last: items.length === 0 }
  }
  const before: string[] = []
  for (const workspace of items) {
    const pinned = options.pinCurrent === true && workspace.workspaceId === options.currentWorkspaceId
    if (pinned || workspaceActivityAt(workspace, options) >= activityAt) before.push(workspace.workspaceId)
  }
  return { activityAt, before, last: before.length === items.length }
}

/**
 * Find the workspace accounting a session.
 * @param items - workspace rows.
 * @param sessionId - the session to locate, or undefined when none is selected.
 * @returns the owning workspace id, or undefined when the session is ungrouped.
 */
export function workspaceOfSession(
  items: readonly WorkspaceLike[],
  sessionId: string | undefined,
): string | undefined {
  if (sessionId === undefined) return undefined
  for (const workspace of items) {
    if (workspace.sessionIds.includes(sessionId)) return workspace.workspaceId
  }
  return undefined
}

/**
 * Order workspaces newest-active first.
 *
 * Ties keep the host's manual order: `Array.prototype.sort` is stable, so
 * workspaces the user arranged by hand stay arranged relative to each other
 * whenever activity cannot separate them.
 *
 * The ungrouped bucket is not part of this list — the sidebar synthesizes it
 * after every real workspace — so stray sessions keep trailing the list for
 * free.
 * @param items - workspace rows in host order.
 * @param options - session/archive state and pinning preferences.
 * @returns a new array in render order; the input is never mutated.
 */
export function sortWorkspaces(
  items: readonly WorkspaceLike[],
  options: SortOptions,
): readonly WorkspaceLike[] {
  if (items.length < 2) return items
  const activity = new Map<string, number>()
  for (const workspace of items) {
    activity.set(workspace.workspaceId, workspaceActivityAt(workspace, options))
  }
  const ranked = [...items].sort((left, right) => {
    const leftAt = activity.get(left.workspaceId) ?? NEVER
    const rightAt = activity.get(right.workspaceId) ?? NEVER
    // Explicit comparison, not subtraction: -Infinity minus -Infinity is NaN,
    // which would make the comparator incoherent for never-active rows.
    if (leftAt === rightAt) return 0
    return leftAt > rightAt ? -1 : 1
  })
  if (options.pinCurrent !== true || options.currentWorkspaceId === undefined) return ranked
  const index = ranked.findIndex(workspace => workspace.workspaceId === options.currentWorkspaceId)
  if (index <= 0) return ranked
  const current = ranked[index]
  if (current === undefined) return ranked
  return [current, ...ranked.slice(0, index), ...ranked.slice(index + 1)]
}

/**
 * Whether two workspace lists are the same rows in the same order.
 *
 * The wrapper uses this to decide whether a session-state change actually
 * moved anything, so a stream frame that changes nothing visible does not
 * wake the sidebar.
 * @param left - one list.
 * @param right - the other list.
 * @returns true when both lists hold identical ids in identical positions.
 */
export function sameOrder(
  left: readonly WorkspaceLike[],
  right: readonly WorkspaceLike[],
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((workspace, index) => workspace.workspaceId === right[index]?.workspaceId)
}
