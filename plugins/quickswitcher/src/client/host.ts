/**
 * Structural views of the host services this plugin reads.
 *
 * Each interface names only the fields the switcher uses, so the plugin
 * compiles without the host's type packages and keeps working as long as
 * those fields keep their shape. Field meanings follow
 * `@deepseek-ai/dsh-api-session-controller/client` (SessionSummary,
 * SessionListState), `@deepseek-ai/dsh-api-workspace-controller/client`
 * (WorkspaceSnapshot, WorkspaceView) and `@deepseek-ai/dsh-client-shortcuts`.
 * @module
 */

/** Read and subscribe, the shape of every host observable. */
export interface Source<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** One session list row. */
export interface SessionRow {
  readonly id: string
  /** Durable title, then project basename, then session id. */
  readonly displayTitle: string
  readonly cwd?: string | undefined
  /** `'subagent'` rows have no sidebar row of their own. */
  readonly origin?: string | undefined
  /** Empty-log New Session placeholder. */
  readonly blank: boolean
  readonly running: boolean
  /** Epoch-ms last change. */
  readonly updatedAt: number
  /** Local reference counts; `mainView > 0` marks the open session. */
  readonly retainedBy?: Readonly<Record<string, number | undefined>> | undefined
}

/** The session list snapshot. */
export interface SessionList {
  /** Host list order. */
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionRow | undefined>>
}

/** One workspace row. */
export interface WorkspaceRow {
  readonly workspaceId: string
  readonly title: string
  /** Canonical host directory path. */
  readonly path: string
  /** Sessions accounted to this workspace. */
  readonly sessionIds: readonly string[]
}

/** The workspace snapshot. */
export interface WorkspaceList {
  readonly items: readonly WorkspaceRow[]
  /** Registry-global archive set. */
  readonly archivedSessionIds: readonly string[]
}

/** One content-search hit. */
export interface ContentHit {
  readonly sessionId: string
  readonly snippet: string
}

/** `RemoteResult` from the typert protocol. */
export type RemoteResult<T> =
  | { readonly ok: true, readonly value: T }
  | { readonly ok: false, readonly error: { readonly message: string } }

/** Device platform the shortcut service reports. */
export type Platform = 'macos' | 'windows' | 'linux'

/** Physical-key binding accepted by the shortcut service. */
export interface Binding {
  readonly code: string
  readonly modifiers: readonly ('primary' | 'control' | 'alt' | 'shift' | 'meta')[]
}

/** Normalized key facts the shortcut adapter delivers. */
export interface Gesture {
  readonly code: string
  readonly control: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly repeat: boolean
  readonly composing: boolean
  readonly defaultPrevented: boolean
}

/** Input owner and topmost modal at the time of a keydown. */
export interface InputContext {
  readonly region: 'page' | 'editable' | 'terminal'
  /** `data-shortcut-modal` of the topmost dialog, `'other'` when unnamed, null when none. */
  readonly modal: string | null
}

/** What `observeFixedInput` delivers. */
export type FixedInput =
  | { readonly type: 'keydown', readonly gesture: Gesture, readonly context: InputContext, consume(): void }
  | { readonly type: 'reset' }

/** The `ctx.shortcuts` slice this plugin uses. */
export interface ShortcutsLike {
  readonly platform: Platform
  registerFixed(command: {
    id: string
    label: () => string
    keys: readonly string[]
    bindings: readonly [Binding, ...Binding[]]
    group: 'application' | 'input' | 'menus' | 'approval'
  }): () => void
  observeFixedInput(listener: (input: FixedInput) => void): () => void
  describeBinding(binding: Binding): { keys: readonly string[] }
}

/** The `ctx.sessions` slice this plugin uses. */
export interface SessionsLike {
  readonly list: Source<SessionList>
  search(query: string, signal: AbortSignal): Promise<RemoteResult<{ items: ContentHit[], hasMore: boolean }>>
}

/** The `ctx.workspaces` slice this plugin uses. */
export interface WorkspacesLike {
  readonly list: Source<WorkspaceList>
}

/** The `ctx.uiWorkspace` slice this plugin uses: the sidebar's own navigation. */
export interface UiWorkspaceLike {
  openSession(sessionId: string): void
  /** New Session in a workspace, the sidebar's workspace-pick action. */
  startSession(workspaceId: string, options: { clearPreviousDraft: boolean }): void
}

/** The `ctx.slots` slice this plugin uses. */
export interface SlotsLike {
  inject(key: string, setup: () => () => void): void
  register(
    options: { name: string, id: string, order?: number, inject?: () => object },
    component: unknown,
  ): () => void
}

/**
 * The session currently shown in the main view.
 * @param list - session list snapshot.
 * @returns its id, or undefined when none is open.
 */
export function mainSessionId(list: SessionList): string | undefined {
  for (const id of list.ids) {
    if ((list.byId[id]?.retainedBy?.['mainView'] ?? 0) > 0) return id
  }
  // Retained rows outside the host list (subagent fallbacks) still count.
  for (const [id, row] of Object.entries(list.byId)) {
    if ((row?.retainedBy?.['mainView'] ?? 0) > 0) return id
  }
  return undefined
}
