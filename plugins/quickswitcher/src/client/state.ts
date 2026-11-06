/**
 * Open/closed state shared by the keyboard handler and the overlay.
 * @module
 */

export interface SwitcherState {
  readonly open: boolean
  /** Bumped on every open so the dialog remounts with a fresh query. */
  readonly generation: number
}

export interface SwitcherStore {
  getSnapshot(): SwitcherState
  subscribe(listener: () => void): () => void
  open(): void
  close(): void
}

/** @returns a closed store. */
export function createSwitcherStore(): SwitcherStore {
  let state: SwitcherState = { open: false, generation: 0 }
  const listeners = new Set<() => void>()
  const set = (next: SwitcherState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open() {
      if (!state.open) set({ open: true, generation: state.generation + 1 })
    },
    close() {
      if (state.open) set({ ...state, open: false })
    },
  }
}
