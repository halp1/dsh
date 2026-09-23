/**
 * dsh-plugin-badge, browser half: mirrors the sidebar's unread dots onto the
 * installed PWA's app icon through the Badging API.
 *
 * The plugin has no UI of its own. It binds the three host observables that
 * decide whether a sidebar row shows a dot, folds them into one number, and
 * publishes that number to `navigator.setAppBadge`. Everything user-facing is
 * the operating system's: the numeric bubble on the dock/taskbar icon.
 *
 * A `ctx.badge` service is provided so the preferences can be changed at
 * runtime (from the devtools console, or by a settings plugin) and so another
 * plugin can read the current count without re-deriving it.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Session Controller's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the Workspace Controller's Context merge (ctx.workspaces).
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls ui-session's Context merge (ctx.uiSession).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { BadgeApplier, badgingSupported } from './badge.ts'
import { installBadgeWatcher, type BadgeSources, type BadgeWatcher } from './watcher.ts'
import { loadSettings, saveSettings, type BadgeSettings } from './settings.ts'

export { BadgeApplier, badgingSupported, stripTitleCount, titleWithCount } from './badge.ts'
export type { BadgeApplierOptions, BadgeTarget, TitleTarget } from './badge.ts'
export {
  ATTENTION_KINDS,
  DEFAULT_COUNT_OPTIONS,
  countUnread,
  isAttentionKind,
  sessionCounts,
  sessionVisible,
} from './count.ts'
export type { BadgeCountInput, BadgeCountOptions } from './count.ts'
export {
  BADGE_SETTINGS_KEY,
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './settings.ts'
export type { BadgeSettings, SettingsStorage } from './settings.ts'
export { installBadgeWatcher, readCount } from './watcher.ts'
export type { ArchiveSnapshot, BadgeSources, BadgeWatcher, BadgeWatcherOptions } from './watcher.ts'

/** Runtime face other plugins (and the devtools console) can use. */
export interface BadgeService {
  /** The count currently published to the app icon. */
  readonly count: number
  /** Whether this browser can actually render an app badge. */
  readonly supported: boolean
  /** A copy of the live settings. */
  settings(): BadgeSettings
  /**
   * Merge a partial settings change, persist it, and republish immediately.
   * @param patch - the fields to change.
   */
  configure(patch: Partial<BadgeSettings>): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live unread badge count and its per-device preferences. */
    badge: BadgeService
  }
}

/**
 * Services required before the badge can bind. `sessions` and `workspaces` are
 * the Controller object layers; `uiSession` owns the pending-interaction map
 * that approval/plan-review/question dots come from.
 */
export const inject = ['sessions', 'workspaces', 'uiSession']

/** Stable Cordis plugin name. */
export const name = 'badge'

/**
 * Console handle. The client context is not reachable from devtools (the web
 * shell exposes only the boot graph and the module loader), so the service is
 * also parked on `window` under this key — the supported way for a human to
 * read the count or change a preference at runtime.
 */
export const BADGE_GLOBAL = '__dshBadge__'

/**
 * Client plugin body: bind the host sources, publish the count, expose the
 * `badge` service.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage
  let settings = loadSettings(storage)

  const applier = new BadgeApplier(
    typeof navigator === 'undefined' ? undefined : navigator,
    typeof document === 'undefined' ? undefined : document,
    () => settings,
  )

  const sources: BadgeSources = {
    sessions: ctx.sessions.list,
    workspaces: ctx.workspaces.list,
    pendingInteractions: ctx.uiSession.pendingInteractions,
  }

  // Assigned by the effect below and read by the service face. The effect runs
  // synchronously during apply, but the service tolerates its absence so a
  // disposed fiber's lingering service reference cannot throw.
  let watcher: BadgeWatcher | undefined

  ctx.effect(() => {
    watcher = installBadgeWatcher(sources, {
      applier,
      getOptions: () => settings,
    })
    return () => {
      watcher?.dispose()
      watcher = undefined
    }
  }, 'badge: sidebar unread watcher')

  const service: BadgeService = {
    get count() { return watcher?.count ?? 0 },
    get supported() { return badgingSupported(typeof navigator === 'undefined' ? undefined : navigator) },
    settings: () => ({ ...settings }),
    configure: (patch: Partial<BadgeSettings>) => {
      settings = { ...settings, ...patch }
      saveSettings(storage, settings)
      // Force: a presentation change (title mirror on/off) can leave the number
      // identical while still needing a write.
      watcher?.refresh()
    },
  }

  ctx.provide('badge', service)

  // Devtools handle, removed on teardown so a disposed fiber leaves no stale
  // service behind for HMR reloads.
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    const target = window as unknown as Record<string, unknown>
    target[BADGE_GLOBAL] = service
    return () => { delete target[BADGE_GLOBAL] }
  }, 'badge: devtools handle')
}
