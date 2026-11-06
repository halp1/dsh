/**
 * dsh-plugin-quickswitcher, browser half.
 *
 * Cmd+K (macOS) or Ctrl+K (elsewhere) opens a switcher over the whole frame.
 *
 * The key is a fixed shortcut rather than an editable command because the
 * shortcut service rejects plain Mod+K as a Web default. A fixed action
 * reserves the combination, appears in the shortcut reference, and receives
 * locally arbitrated keydowns through `observeFixedInput`, the same route the
 * built-in font-size keys use.
 *
 * Navigation goes through `ctx.uiWorkspace`, the sidebar's own open actions,
 * so selection, reveal, and blank-session reuse behave exactly as a click.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionsLike, ShortcutsLike, SlotsLike, UiWorkspaceLike, WorkspacesLike } from './host.ts'
import { mainSessionId } from './host.ts'
import { isDisabled } from './content-search.ts'
import { createRecent, type RecentStorage } from './recent.ts'
import { createSwitcherStore, type SwitcherStore } from './state.ts'
import { injectStyles } from './styles.ts'
import { MODAL_ID, QuickSwitcher, type SwitcherDeps } from './switcher.tsx'
import { TRIGGER_CODE, isTrigger } from './trigger.ts'

/** Stable Cordis plugin name. */
export const name = 'quickswitcher'

/** Host services the switcher reads and drives. */
export const inject = ['shortcuts', 'slots', 'sessions', 'workspaces', 'uiWorkspace']

/** Devtools handle. */
export const QUICKSWITCHER_GLOBAL = '__dshQuickSwitcher__'

/** The services, viewed through the structural shapes in host.ts. */
interface Services {
  shortcuts: ShortcutsLike
  slots: SlotsLike
  sessions: SessionsLike
  workspaces: WorkspacesLike
  uiWorkspace: UiWorkspaceLike
}

function localStorageOrUndefined(): RecentStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  if (typeof document === 'undefined') return
  const { shortcuts, slots, sessions, workspaces, uiWorkspace } = ctx as unknown as Services
  const store: SwitcherStore = createSwitcherStore()
  const recent = createRecent(localStorageOrUndefined())

  ctx.effect(() => injectStyles(document), 'quickswitcher: styles')

  const binding = { code: TRIGGER_CODE, modifiers: ['primary'] } as const
  ctx.effect(() => shortcuts.registerFixed({
    id: 'quickswitcher.open',
    label: () => 'Quick switcher',
    keys: shortcuts.describeBinding(binding).keys,
    bindings: [binding],
    group: 'application',
  }), 'quickswitcher: shortcut reference')

  ctx.effect(() => shortcuts.observeFixedInput((input) => {
    if (input.type !== 'keydown' || !isTrigger(input, shortcuts.platform)) return
    const { modal } = input.context
    if (modal === MODAL_ID) {
      input.consume()
      store.close()
      return
    }
    // Another dialog (Settings, a confirmation) owns the keyboard.
    if (modal !== null) return
    input.consume()
    store.open()
  }), 'quickswitcher: Mod+K')

  ctx.effect(() => {
    // Record every session that becomes the main view, however it was opened.
    let last = mainSessionId(sessions.list.getSnapshot())
    if (last !== undefined) recent.push(last)
    return sessions.list.subscribe(() => {
      const current = mainSessionId(sessions.list.getSnapshot())
      if (current === undefined || current === last) return
      last = current
      recent.push(current)
    })
  }, 'quickswitcher: recent sessions')

  // A deployment with full-text search off answers every query with the same
  // failure; after the first one, the switcher stops asking until reload.
  let searchDisabled = false

  const deps: SwitcherDeps = {
    store,
    sessions: sessions.list,
    workspaces: workspaces.list,
    recent: () => recent.list(),
    search: async (query, signal) => {
      if (searchDisabled) return { ok: false, error: { message: 'session search is disabled' } }
      const result = await sessions.search(query, signal)
      if (!result.ok && isDisabled(result.error.message)) searchDisabled = true
      return result
    },
    openSession: (sessionId) => { uiWorkspace.openSession(sessionId) },
    // The sidebar's workspace pick: open the workspace's New Session (reusing
    // its blank, keeping any unsent draft). uiWorkspace reports failures
    // through its own notice.
    openWorkspace: (workspaceId) => { uiWorkspace.startSession(workspaceId, { clearPreviousDraft: false }) },
  }

  slots.inject('shell.overlay', () => slots.register({
    name: 'shell.overlay',
    id: 'quickswitcher',
    order: 100,
    inject: () => deps,
  }, QuickSwitcher))

  ctx.effect(() => {
    const target = window as unknown as Record<string, unknown>
    target[QUICKSWITCHER_GLOBAL] = { open: () => store.open(), close: () => store.close(), recent: () => recent.list() }
    return () => {
      store.close()
      delete target[QUICKSWITCHER_GLOBAL]
    }
  }, 'quickswitcher: devtools handle')
}
