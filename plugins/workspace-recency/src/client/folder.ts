/**
 * Moves the Ungrouped folder to its activity rank among the workspace groups.
 *
 * The sidebar builds the Ungrouped group itself and always appends it after
 * every workspace (`groupByWorkspace` in ui-workspace), so no data-level
 * change can move it. This module moves it visually instead: it injects one
 * stylesheet that makes the session tree a flex column and gives the group
 * sections CSS `order` values. React's DOM is never touched, so the sidebar's
 * own reconciliation, drag-and-drop, and row animations keep working.
 *
 * Every selector is attribute-based (`role="tree"`, `data-row-key`), never a
 * hashed CSS-module class name, so it survives ui-workspace rebuilds.
 */

import {
  mainSessionId,
  placeUngrouped,
  ungroupedSessionIds,
  workspaceOfSession,
  type SessionListLike,
  type UngroupedPlacement,
} from './activity.ts'
import type { RecencySettings } from './settings.ts'
import type { Source, WorkspaceSnapshotLike } from './sorter.ts'

/** `data-plugin-css` value of the injected stylesheet. */
export const FOLDER_STYLE_ID = 'dsh-plugin-workspace-recency/ungrouped-folder'

/** Quote a value for a CSS attribute selector. */
function cssString(value: string): string {
  return `"${value.replace(/["\\]/g, ch => `\\${ch}`)}"`
}

/**
 * Build the stylesheet that places Ungrouped after `placement.before`.
 *
 * Root group sections default to order 2, the sections that outrank Ungrouped
 * get 0, and Ungrouped itself gets 1. The sidebar's `section + section`
 * spacing rule is DOM-adjacency based and would leave a gap above whichever
 * folder is visually first, so spacing moves to a flex `gap`.
 * @param placement - where Ungrouped belongs.
 * @returns CSS text, or an empty string when the sidebar's own layout is already right.
 */
export function folderStylesheet(placement: UngroupedPlacement): string {
  if (placement.last) return ''
  // A group section is a direct child of the tree; its header row may sit
  // inside a HoverCard wrapper, so headers are matched as descendants. Nested
  // tree-mode children sit in their own role="group" and are left alone.
  const tree = '[role="tree"]:has(> div [data-row-key="workspace:"])'
  const ungrouped = `${tree} > div:has([data-row-key="workspace:"]):not(:has([role="group"] [data-row-key="workspace:"]))`
  const rules = [
    `${tree} { display: flex; flex-direction: column; row-gap: 4px; }`,
    `${tree} > * { flex-shrink: 0; margin-top: 0; order: 2; }`,
    `${ungrouped} { order: 1; }`,
  ]
  if (placement.before.length > 0) {
    const selectors = placement.before.map(id =>
      `${tree} > div:has([data-row-key=${cssString(`workspace:${id}`)}])`)
    rules.push(`${selectors.join(',\n')} { order: 0; }`)
  }
  return `${rules.join('\n')}\n`
}

/** Everything {@link computePlacement} reads. */
export interface PlacementSources {
  workspaces: Source<WorkspaceSnapshotLike>
  sessions: Source<SessionListLike>
}

/**
 * Rank Ungrouped against the current workspaces.
 * @param sources - workspace and session state.
 * @param settings - the live settings.
 * @returns the placement.
 */
export function computePlacement(sources: PlacementSources, settings: RecencySettings): UngroupedPlacement {
  const snapshot = sources.workspaces.getSnapshot()
  const list = sources.sessions.getSnapshot()
  const ungroupedIds = ungroupedSessionIds(snapshot.items, list)
  const open = mainSessionId(list)
  const currentWorkspaceId = workspaceOfSession(snapshot.items, open)
  return placeUngrouped(snapshot.items, {
    sessions: list.byId,
    archived: new Set(snapshot.archivedSessionIds),
    ungroupedIds,
    currentWorkspaceId,
    currentInUngrouped: open !== undefined && currentWorkspaceId === undefined && ungroupedIds.includes(open),
    pinCurrent: settings.pinCurrent,
  })
}

/** Minimal document face, so tests can run without a DOM. */
export interface StyleHost {
  createElement(tag: 'style'): { textContent: string | null, dataset: DOMStringMap, remove(): void }
  head: { appendChild(node: unknown): unknown }
}

/** A running placement: the current stylesheet, a forced refresh, and teardown. */
export interface FolderPlacer {
  /** The CSS currently applied (empty when Ungrouped stays last). */
  readonly css: string
  /** The latest placement. */
  readonly placement: UngroupedPlacement
  /** Re-evaluate now (used when a setting changed). */
  refresh(): void
  /** Remove the stylesheet and stop listening. */
  dispose(): void
}

/**
 * Keep the Ungrouped folder at its activity rank.
 * @param sources - workspace and session state.
 * @param getSettings - reads the live settings.
 * @param host - the document to inject into; undefined disables rendering (tests, SSR).
 * @returns the placer handle.
 */
export function installFolderPlacement(
  sources: PlacementSources,
  getSettings: () => RecencySettings,
  host: StyleHost | undefined,
): FolderPlacer {
  let style: ReturnType<StyleHost['createElement']> | undefined
  let css = ''
  let placement: UngroupedPlacement = { activityAt: Number.NEGATIVE_INFINITY, before: [], last: true }

  const update = (): void => {
    const settings = getSettings()
    placement = settings.enabled && settings.moveUngroupedFolder
      ? computePlacement(sources, settings)
      : { activityAt: Number.NEGATIVE_INFINITY, before: [], last: true }
    const next = folderStylesheet(placement)
    if (next === css) return
    css = next
    if (host === undefined) return
    if (style === undefined) {
      style = host.createElement('style')
      style.dataset['pluginCss'] = FOLDER_STYLE_ID
      host.head.appendChild(style)
    }
    style.textContent = css
  }

  const unsubscribes = [
    sources.workspaces.subscribe(update),
    sources.sessions.subscribe(update),
  ]
  update()

  return {
    get css() { return css },
    get placement() { return placement },
    refresh: update,
    dispose: () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
      style?.remove()
      style = undefined
      css = ''
    },
  }
}
