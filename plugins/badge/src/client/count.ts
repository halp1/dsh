/**
 * Badge counting: the pure projection from host state to one integer.
 *
 * The contract is "whatever puts a circle on a sidebar row puts a unit on the
 * app icon", so this module deliberately mirrors ui-workspace's own two
 * decisions rather than inventing a parallel notion of unread:
 *
 *  - **Visibility** mirrors `sessionVisible`: subagent-origin rows never get
 *    their own sidebar row (they fold into their parent's header catalog),
 *    archived rows are gone everywhere, and a blank row only shows while it is
 *    the selected provisional New Session. A row with no sidebar presence can
 *    have no sidebar dot, so it cannot contribute.
 *
 *  - **Attention** mirrors the `warning`/`done` arms of `sessionStatuses`: a
 *    pending interaction (approval, plan review, question) or the
 *    `completionUnread` reminder bit, both read from ui-session's unified
 *    `sessionStatus` map exactly as ui-workspace's `sessionNode` does. The
 *    `ongoing` arms — a running session and its
 *    running subagents — are deliberately excluded: a spinning session is work
 *    in progress, not an item waiting to be read, and counting it would pin the
 *    badge to a non-zero number for the entire length of every turn.
 *
 * `completionUnread` is ui-session-owned and already means "finished outside
 * the main view and not yet acknowledged", so opening a session clears its own
 * contribution without any read-tracking state on this side. Pending interactions are counted even for
 * the session currently on screen: a question is still outstanding until it is
 * answered, and the host drops it from the map the moment it is.
 */

import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Pending-interaction kinds that render as a warning dot in the sidebar. The
 * host's `kind` field is an open string (domains merge their own values in), so
 * an unrecognized kind is treated as no dot — the same defaulting
 * `visiblePendingKind` applies before choosing a row presentation.
 */
export const ATTENTION_KINDS: readonly string[] = ['approval', 'plan-review', 'question']

/** Which classes of sidebar dot contribute to the badge. */
export interface BadgeCountOptions {
  /**
   * Count the green "done" reminder — a session that finished while it was not
   * the selected one and has not been opened since.
   */
  countCompleted: boolean
  /**
   * Count the warning dot — a session blocking on approval, plan review, or an
   * answer to a question.
   */
  countAttention: boolean
  /**
   * Count the blue "ongoing" dot — a running session or one with running
   * subagents. Off by default: in-progress work is not an unread item.
   */
  countRunning: boolean
}

/** Attention plus completion, matching what the user reads as "unread". */
export const DEFAULT_COUNT_OPTIONS: BadgeCountOptions = {
  countCompleted: true,
  countAttention: true,
  countRunning: false,
}

/** The inputs one badge computation reads; grouped so callers pass one object. */
export interface BadgeCountInput {
  /** Session list snapshot (`ctx.sessions.list`); main-view retention marks the selection. */
  list: SessionListState
  /** Registry-global archive set (`ctx.workspaces.list` → `archivedSessionIds`). */
  archivedSessionIds: readonly SessionId[]
  /** Running, pending-interaction, and completion facts by session (`uiSession.sessionStatus`). */
  statuses: SessionStatusSnapshot
}

/**
 * Whether a session occupies a row of its own in the sidebar. Mirrors
 * ui-workspace's `sessionVisible`.
 * @param session - the session summary under test.
 * @param current - the selected session id, if any.
 * @param archived - registry-global archive set.
 * @returns true when the session can carry a sidebar dot.
 */
export function sessionVisible(
  session: SessionSummary,
  current: SessionId | undefined,
  archived: ReadonlySet<SessionId>,
): boolean {
  if (session.origin === 'subagent') return false
  if (archived.has(session.id)) return false
  return !session.blank || session.id === current
}

/**
 * The session the main view currently shows. Mirrors ui-workspace's
 * `mainSessionId`: the list carries no selection field, so the selected row is
 * the one the main view holds a retain reference on.
 * @param list - the session list snapshot.
 * @returns the main-view session id, if any.
 */
export function mainSessionId(list: SessionListState): SessionId | undefined {
  return Object.values(list.byId).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id
}

/**
 * Whether a pending-interaction kind renders as a warning dot.
 * @param kind - the domain-owned discriminator, or undefined when none is pending.
 * @returns true for approval, plan review, and question.
 */
export function isAttentionKind(kind: string | undefined): boolean {
  return kind !== undefined && ATTENTION_KINDS.includes(kind)
}

/**
 * Whether one visible session contributes a badge unit under the given options.
 * @param session - the session summary under test.
 * @param status - its ui-session status entry, if any.
 * @param options - which dot classes count.
 * @returns true when the session should add one to the badge.
 */
export function sessionCounts(
  session: SessionSummary,
  status: Partial<SessionStatus> | undefined,
  options: BadgeCountOptions,
): boolean {
  // Precedence follows sessionStatuses: a pending interaction is the primary
  // status, so a session blocking on the user counts as attention even if it
  // also carries the completion reminder.
  if (isAttentionKind(status?.pendingInteraction?.kind)) return options.countAttention
  // The status entry is authoritative once established; the summary's bit is
  // the pre-baseline fallback, as in ui-workspace's sessionNode.
  if (options.countRunning && (status?.running ?? session.running)) return true
  return options.countCompleted && status?.completionUnread === true
}

/**
 * Count the sidebar rows currently showing an unread dot.
 *
 * Each qualifying session contributes exactly one unit, matching the one-dot-
 * per-row presentation; a session blocking on approval while also running is
 * still a single item to deal with.
 * @param input - list, archive set, and session statuses.
 * @param options - which dot classes count (defaults to attention + completed).
 * @returns the badge number; 0 means "clear the badge".
 */
export function countUnread(
  input: BadgeCountInput,
  options: BadgeCountOptions = DEFAULT_COUNT_OPTIONS,
): number {
  const { list, archivedSessionIds, statuses } = input
  const archived = new Set(archivedSessionIds)
  const current = mainSessionId(list)
  let count = 0
  for (const id of list.ids) {
    const session = list.byId[id]
    if (session === undefined) continue
    if (!sessionVisible(session, current, archived)) continue
    if (sessionCounts(session, statuses.get(id), options)) count += 1
  }
  return count
}
