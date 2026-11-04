/**
 * The pure ranking core: host snapshots plus a query in, switcher sections out.
 * @module
 */
import type { ContentHit, SessionList, SessionRow, WorkspaceList, WorkspaceRow } from './host.ts'
import { fuzzyMatch, mergeRanges, substringMatch, tokenize, type Range } from './match.ts'

/** A session row. */
export interface SessionItem {
  readonly kind: 'session'
  readonly key: string
  readonly sessionId: string
  readonly title: string
  readonly titleRanges: readonly Range[]
  /** Owning workspace title, or the cwd basename for ungrouped sessions. */
  readonly context: string
  readonly contextRanges: readonly Range[]
  readonly running: boolean
  readonly updatedAt: number
}

/** A workspace row. */
export interface WorkspaceItem {
  readonly kind: 'workspace'
  readonly key: string
  readonly workspaceId: string
  readonly title: string
  readonly titleRanges: readonly Range[]
  /** Directory, with the home prefix shortened to `~`. */
  readonly context: string
  readonly contextRanges: readonly Range[]
}

/** A session found by message content. */
export interface MessageItem {
  readonly kind: 'message'
  readonly key: string
  readonly sessionId: string
  readonly title: string
  readonly context: string
  readonly snippet: string
  readonly running: boolean
  readonly updatedAt: number
}

export type Item = SessionItem | WorkspaceItem | MessageItem

/** One labelled group of rows. */
export interface Section {
  readonly key: 'recent' | 'sessions' | 'workspaces' | 'messages'
  readonly label: string
  readonly items: readonly Item[]
}

/** Everything {@link buildSections} reads. */
export interface BuildInput {
  readonly query: string
  readonly sessions: SessionList
  readonly workspaces: WorkspaceList
  /** Recently opened session ids, newest first. */
  readonly recent: readonly string[]
  /** The session in the main view, which is never offered. */
  readonly currentId?: string | undefined
  /** Content-search hits for this query, in host order. */
  readonly contentHits?: readonly ContentHit[]
}

export const RECENT_CAP = 8
export const SESSION_CAP = 50
export const WORKSPACE_CAP = 20
export const MESSAGE_CAP = 20

/** A context-field match counts for less than a title match. */
const CONTEXT_WEIGHT = 0.5

/** Final path segment. */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut === -1 ? trimmed : trimmed.slice(cut + 1)
}

/**
 * Shorten a macOS or Linux home prefix to `~`.
 * @param path - absolute directory.
 * @returns the display path.
 */
export function displayPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
}

/** The rows a switcher may offer, with their workspace context. */
interface Candidate {
  readonly row: SessionRow
  readonly context: string
}

/**
 * Sessions the switcher can open, in host list order.
 *
 * Subagent rows, blank placeholders, archived rows, and the open session are
 * left out: none of them is somewhere you would switch to.
 */
function candidates(input: BuildInput): Map<string, Candidate> {
  const archived = new Set(input.workspaces.archivedSessionIds)
  const owner = new Map<string, WorkspaceRow>()
  for (const workspace of input.workspaces.items) {
    for (const id of workspace.sessionIds) if (!owner.has(id)) owner.set(id, workspace)
  }
  const out = new Map<string, Candidate>()
  for (const id of input.sessions.ids) {
    const row = input.sessions.byId[id]
    if (row === undefined || row.blank || row.origin === 'subagent') continue
    if (archived.has(id) || id === input.currentId) continue
    const context = owner.get(id)?.title ?? (row.cwd === undefined ? '' : basename(row.cwd))
    out.set(id, { row, context })
  }
  return out
}

/** Score every token against a primary and a secondary field. */
function matchFields(
  tokens: readonly string[],
  primary: string,
  secondary: string,
): { score: number, primaryRanges: Range[], secondaryRanges: Range[] } | null {
  let score = 0
  const primaryRanges: Range[] = []
  const secondaryRanges: Range[] = []
  for (const token of tokens) {
    const a = fuzzyMatch(token, primary)
    const b = secondary === '' ? null : fuzzyMatch(token, secondary)
    const bScore = b === null ? Number.NEGATIVE_INFINITY : b.score * CONTEXT_WEIGHT
    if (a === null && b === null) return null
    if (a !== null && a.score >= bScore) {
      score += a.score
      primaryRanges.push(...a.ranges)
    } else if (b !== null) {
      score += bScore
      secondaryRanges.push(...b.ranges)
    }
  }
  return { score, primaryRanges: mergeRanges(primaryRanges), secondaryRanges: mergeRanges(secondaryRanges) }
}

function sessionItem(candidate: Candidate, titleRanges: readonly Range[] = [], contextRanges: readonly Range[] = []): SessionItem {
  const { row, context } = candidate
  return {
    kind: 'session',
    key: `session:${row.id}`,
    sessionId: row.id,
    title: row.displayTitle,
    titleRanges,
    context,
    contextRanges,
    running: row.running,
    updatedAt: row.updatedAt,
  }
}

function workspaceItem(workspace: WorkspaceRow, titleRanges: readonly Range[] = [], contextRanges: readonly Range[] = []): WorkspaceItem {
  return {
    kind: 'workspace',
    key: `workspace:${workspace.workspaceId}`,
    workspaceId: workspace.workspaceId,
    title: workspace.title,
    titleRanges,
    context: displayPath(workspace.path),
    contextRanges,
  }
}

/**
 * Rank everything for one query.
 *
 * An empty query lists where you have been: recently opened sessions, topped
 * up by recently changed ones, then every workspace. A query lists workspace
 * matches, session matches, and (once the host answers) sessions whose
 * messages contain it.
 * @param input - snapshots, query, recency, and content hits.
 * @returns non-empty sections in display order.
 */
export function buildSections(input: BuildInput): Section[] {
  const pool = candidates(input)
  const recentRank = new Map(input.recent.map((id, index) => [id, index]))
  const tokens = tokenize(input.query)
  const sections: Section[] = []

  if (tokens.length === 0) {
    const ordered = [...pool.values()].sort((a, b) => {
      const ra = recentRank.get(a.row.id) ?? Number.POSITIVE_INFINITY
      const rb = recentRank.get(b.row.id) ?? Number.POSITIVE_INFINITY
      if (ra !== rb) return ra - rb
      return b.row.updatedAt - a.row.updatedAt
    })
    push(sections, 'recent', 'Recent', ordered.slice(0, RECENT_CAP).map(c => sessionItem(c)))
    push(sections, 'workspaces', 'Workspaces', input.workspaces.items.slice(0, WORKSPACE_CAP).map(w => workspaceItem(w)))
    return sections
  }

  const sessionHits: { item: SessionItem, score: number }[] = []
  for (const candidate of pool.values()) {
    const hit = matchFields(tokens, candidate.row.displayTitle, candidate.context)
    if (hit === null) continue
    sessionHits.push({ item: sessionItem(candidate, hit.primaryRanges, hit.secondaryRanges), score: hit.score })
  }
  sessionHits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const ra = recentRank.get(a.item.sessionId) ?? Number.POSITIVE_INFINITY
    const rb = recentRank.get(b.item.sessionId) ?? Number.POSITIVE_INFINITY
    if (ra !== rb) return ra - rb
    return b.item.updatedAt - a.item.updatedAt
  })
  const shownSessions = sessionHits.slice(0, SESSION_CAP).map(hit => hit.item)

  const workspaceHits: { item: WorkspaceItem, score: number, index: number }[] = []
  // Workspaces match by name only, and only on unbroken text: "cs" lists
  // workspaces whose name contains "cs", never ones whose path or scattered
  // letters happen to fit.
  input.workspaces.items.forEach((workspace, index) => {
    let score = 0
    const ranges: Range[] = []
    for (const token of tokens) {
      const hit = substringMatch(token, workspace.title)
      if (hit === null) return
      score += hit.score
      ranges.push(...hit.ranges)
    }
    workspaceHits.push({ item: workspaceItem(workspace, mergeRanges(ranges)), score, index })
  })
  // Ties keep the host's manual workspace order.
  workspaceHits.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.index - b.index))

  // Workspaces lead: a workspace name is the more deliberate target, and its
  // sessions would otherwise bury it ("cs1" lists every cs173 session).
  push(sections, 'workspaces', 'Workspaces', workspaceHits.slice(0, WORKSPACE_CAP).map(hit => hit.item))
  push(sections, 'sessions', 'Sessions', shownSessions)

  const listed = new Set(shownSessions.map(item => item.sessionId))
  const messages: MessageItem[] = []
  for (const hit of input.contentHits ?? []) {
    if (listed.has(hit.sessionId)) continue
    const candidate = pool.get(hit.sessionId)
    if (candidate === undefined) continue
    listed.add(hit.sessionId)
    messages.push({
      kind: 'message',
      key: `message:${hit.sessionId}`,
      sessionId: hit.sessionId,
      title: candidate.row.displayTitle,
      context: candidate.context,
      snippet: hit.snippet,
      running: candidate.row.running,
      updatedAt: candidate.row.updatedAt,
    })
    if (messages.length === MESSAGE_CAP) break
  }
  push(sections, 'messages', 'Messages', messages)
  return sections
}

function push(sections: Section[], key: Section['key'], label: string, items: readonly Item[]): void {
  if (items.length > 0) sections.push({ key, label, items })
}

/**
 * Compact age of a timestamp.
 * @param at - epoch ms.
 * @param now - epoch ms.
 * @returns `now`, `5m`, `3h`, `2d`, `6w`, or `1y`.
 */
export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  if (days < 365) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 365)}y`
}
