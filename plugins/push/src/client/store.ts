/**
 * Browser state: the last status per workspace, which pushes this tab has in
 * flight, and the notice on display. A tiny external store so every row's
 * button reads it through `useSyncExternalStore`.
 * @module
 */

/** Mirrors the node half's `WorkspaceStatus`. */
export type WorkspaceStatus =
  | { readonly workspaceId: string, readonly running: boolean, readonly kind: 'ahead', readonly ahead: number, readonly branch: string }
  | { readonly workspaceId: string, readonly running: boolean, readonly kind: 'idle', readonly reason: 'clean' | 'no-repo' | 'no-remote' | 'detached' }
  | { readonly workspaceId: string, readonly running: boolean, readonly kind: 'error', readonly message: string }

/** One transient notice. `seq` remounts the toast so a repeat restarts its timer. */
export interface Notice {
  readonly seq: number
  readonly tone: 'success' | 'error'
  readonly text: string
}

/** What one button renders. */
export interface ButtonState {
  readonly status: WorkspaceStatus | undefined
  /** A push from this tab, or one the host reports from another tab. */
  readonly running: boolean
}

export interface PushStore {
  subscribe(listener: () => void): () => void
  button(workspaceId: string): ButtonState
  notice(): Notice | null
  /** Replace every status from one status response. */
  setAll(statuses: readonly WorkspaceStatus[]): void
  /** Replace one workspace's status. */
  setOne(status: WorkspaceStatus): void
  setRunning(workspaceId: string, running: boolean): void
  has(workspaceId: string): boolean
  notify(tone: Notice['tone'], text: string): void
  dismiss(): void
}

const EMPTY: ButtonState = Object.freeze({ status: undefined, running: false })

/** Create the store. */
export function createPushStore(): PushStore {
  const listeners = new Set<() => void>()
  const statuses = new Map<string, WorkspaceStatus>()
  const running = new Set<string>()
  /** Cached per-workspace snapshots, so unchanged rows keep their identity. */
  const buttons = new Map<string, ButtonState>()
  let current: Notice | null = null
  let seq = 0

  const emit = () => { for (const listener of listeners) listener() }
  const rebuild = (id: string) => {
    const status = statuses.get(id)
    const next: ButtonState = { status, running: running.has(id) || status?.running === true }
    const prev = buttons.get(id)
    if (prev !== undefined && sameButton(prev, next)) return false
    buttons.set(id, next)
    return true
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    button: id => buttons.get(id) ?? EMPTY,
    notice: () => current,
    setAll(list) {
      const seen = new Set(list.map(status => status.workspaceId))
      for (const id of [...statuses.keys()]) if (!seen.has(id)) statuses.delete(id)
      for (const status of list) statuses.set(status.workspaceId, status)
      let changed = false
      for (const id of new Set([...buttons.keys(), ...seen])) changed = rebuild(id) || changed
      if (changed) emit()
    },
    setOne(status) {
      statuses.set(status.workspaceId, status)
      if (rebuild(status.workspaceId)) emit()
    },
    setRunning(id, value) {
      if (value) running.add(id)
      else running.delete(id)
      if (rebuild(id)) emit()
    },
    has: id => statuses.has(id),
    notify(tone, text) {
      current = { seq: ++seq, tone, text }
      emit()
    },
    dismiss() {
      if (current === null) return
      current = null
      emit()
    },
  }
}

function sameButton(a: ButtonState, b: ButtonState): boolean {
  return a.running === b.running && JSON.stringify(a.status) === JSON.stringify(b.status)
}
