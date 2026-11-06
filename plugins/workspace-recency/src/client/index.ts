/**
 * dsh-plugin-workspace-recency, browser half: orders the sidebar by most
 * recent activity.
 *
 * Three independent pieces, each a view over host state:
 *
 *  - **Workspace groups** — the Workspace Controller's snapshot source is
 *    decorated so the sidebar walks workspaces newest-active first
 *    (`sorter.ts`).
 *  - **Sessions inside Ungrouped** — in the sidebar's Manual order mode, the
 *    ui-workspace view store's Ungrouped account is masked with a newest-first
 *    order (`ungrouped.ts`). "Last updated" mode already does this.
 *  - **The Ungrouped folder itself** — placed at its activity rank among the
 *    workspaces with an injected stylesheet (`folder.ts`), because the sidebar
 *    always appends it last.
 *
 * The plugin renders nothing and never writes to the host or to the saved
 * manual orders, so disabling it restores the sidebar exactly.
 *
 * A `ctx.workspaceRecency` service (also parked on `window`) exposes the
 * preferences and current orders.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Session Controller's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the Workspace Controller's Context merge (ctx.workspaces).
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { installFolderPlacement, type FolderPlacer, type StyleHost } from './folder.ts'
import { installRecencySort, type RecencySorter, type SorterSources } from './sorter.ts'
import { loadSettings, saveSettings, type RecencySettings } from './settings.ts'
import { installUngroupedSessionOrder, type UngroupedOrderer, type UngroupedSources } from './ungrouped.ts'

export {
  currentBlankSessionId,
  mainSessionId,
  placeUngrouped,
  sameOrder,
  sessionsActivityAt,
  sortWorkspaces,
  ungroupedSessionIds,
  workspaceActivityAt,
  workspaceOfSession,
} from './activity.ts'
export type {
  ActivityContext,
  PlacementOptions,
  SessionIndex,
  SessionLike,
  SessionListLike,
  SortOptions,
  UngroupedPlacement,
  WorkspaceLike,
} from './activity.ts'
export { FOLDER_STYLE_ID, computePlacement, folderStylesheet, installFolderPlacement } from './folder.ts'
export type { FolderPlacer, PlacementSources, StyleHost } from './folder.ts'
export {
  DEFAULT_SETTINGS,
  RECENCY_SETTINGS_KEY,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './settings.ts'
export type { RecencySettings, SettingsStorage } from './settings.ts'
export { installRecencySort } from './sorter.ts'
export type {
  PatchableSource,
  RecencySorter,
  SorterSources,
  Source,
  WorkspaceSnapshotLike,
} from './sorter.ts'
export {
  UNGROUPED_ACCOUNT,
  installUngroupedSessionOrder,
  orderByRecency,
  ungroupedRecencyOrder,
} from './ungrouped.ts'
export type { UngroupedOrderer, UngroupedSources, ViewStateLike } from './ungrouped.ts'

/** Runtime face other plugins (and the devtools console) can use. */
export interface WorkspaceRecencyService {
  /** Workspace ids in the order the sidebar currently renders them. */
  readonly order: readonly string[]
  /** Ungrouped session ids as masked in Manual mode (undefined when the mask is off). */
  readonly ungroupedOrder: readonly string[] | undefined
  /** Workspace ids rendered above the Ungrouped folder. */
  readonly ungroupedAfter: readonly string[]
  /** A copy of the live settings. */
  settings(): RecencySettings
  /**
   * Merge a partial settings change, persist it, and re-render immediately.
   * @param patch - the fields to change.
   */
  configure(patch: Partial<RecencySettings>): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Sidebar recency ordering and its per-device preferences. */
    workspaceRecency: WorkspaceRecencyService
  }
}

/**
 * Services required before the sort can bind. `slots` is where the
 * ui-workspace view store is found.
 */
export const inject = ['sessions', 'workspaces', 'slots']

/** Stable Cordis plugin name. */
export const name = 'workspace-recency'

/** Console handle; the client context is not reachable from devtools. */
export const RECENCY_GLOBAL = '__dshWorkspaceRecency__'

/** The slot ui-workspace fills with its browser; its entry carries the view store. */
const BROWSER_SLOT = 'sidebar.workspaces'

/** The registrant of the stock browser entry. */
const BROWSER_REGISTRANT = '@deepseek-ai/dsh-client-ui-workspace'

/** The slot-ledger surface this plugin reads. */
interface SlotLedger {
  entries(key: string): readonly { store?: unknown, registrant?: string | undefined }[]
  subscribe(key: string, fn: () => void): () => void
}

/**
 * Find the live ui-workspace view store instance.
 *
 * ui-workspace registers one shared instance as `{ ...handle, create: () =>
 * instance }`, so calling `create()` returns the exact object the sidebar's
 * `useStore` hook reads, not a fresh copy.
 * @param slots - the slot ledger.
 * @returns the instance, or undefined while ui-workspace has not registered.
 */
function findViewStore(slots: SlotLedger): UngroupedSources['view'] | undefined {
  const entries = slots.entries(BROWSER_SLOT)
  // Prefer the stock registrant; otherwise take the first entry that carries a store.
  const ranked = [
    ...entries.filter(candidate => candidate.registrant === BROWSER_REGISTRANT),
    ...entries.filter(candidate => candidate.registrant !== BROWSER_REGISTRANT),
  ]
  for (const entry of ranked) {
    const handle = entry.store as { create?: () => unknown } | undefined
    if (typeof handle?.create !== 'function') continue
    const instance = handle.create() as UngroupedSources['view'] | undefined
    if (typeof instance?.getSnapshot === 'function' && typeof instance.subscribe === 'function') return instance
  }
  return undefined
}

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage
  let settings = loadSettings(storage)

  const workspaces = ctx.workspaces.list as unknown as SorterSources['workspaces'] & UngroupedSources['workspaces']
  const sessions = ctx.sessions.list as unknown as SorterSources['sessions']
  const slots = (ctx as unknown as { slots: SlotLedger }).slots

  let sorter: RecencySorter | undefined
  let ungrouped: UngroupedOrderer | undefined
  let folder: FolderPlacer | undefined

  ctx.effect(() => {
    sorter = installRecencySort({ workspaces, sessions }, () => settings)
    return () => {
      sorter?.dispose()
      sorter = undefined
    }
  }, 'workspace-recency: sidebar workspace ordering')

  ctx.effect(() => {
    const host = typeof document === 'undefined' ? undefined : document as unknown as StyleHost
    folder = installFolderPlacement({ workspaces, sessions }, () => settings, host)
    return () => {
      folder?.dispose()
      folder = undefined
    }
  }, 'workspace-recency: ungrouped folder placement')

  ctx.effect(() => {
    // The browser entry may register before or after this plugin, and may be
    // re-registered on HMR, so the ledger is watched rather than read once.
    let bound: UngroupedSources['view'] | undefined
    const bind = (): void => {
      const view = findViewStore(slots)
      if (view === bound) return
      ungrouped?.dispose()
      ungrouped = undefined
      bound = view
      if (view === undefined) return
      try {
        ungrouped = installUngroupedSessionOrder({ view, workspaces, sessions }, () => settings)
      } catch (error) {
        console.error('[workspace-recency] could not bind the sidebar view store:', error)
      }
    }
    const unsubscribe = slots.subscribe(BROWSER_SLOT, bind)
    bind()
    return () => {
      unsubscribe()
      ungrouped?.dispose()
      ungrouped = undefined
    }
  }, 'workspace-recency: ungrouped session ordering')

  const service: WorkspaceRecencyService = {
    get order() { return sorter?.order ?? [] },
    get ungroupedOrder() { return ungrouped?.order },
    get ungroupedAfter() { return folder?.placement.before ?? [] },
    settings: () => ({ ...settings }),
    configure: (patch: Partial<RecencySettings>) => {
      settings = { ...settings, ...patch }
      saveSettings(storage, settings)
      sorter?.refresh()
      ungrouped?.refresh()
      folder?.refresh()
    },
  }

  ctx.provide('workspaceRecency', service)

  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    const target = window as unknown as Record<string, unknown>
    target[RECENCY_GLOBAL] = service
    return () => { delete target[RECENCY_GLOBAL] }
  }, 'workspace-recency: devtools handle')
}
