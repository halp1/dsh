/**
 * Debounced, abortable message-content search.
 *
 * Typing fires one host search after a pause, never one per keystroke, and a
 * newer query aborts the request in flight so a slow answer to an old query
 * can never replace a newer one.
 * @module
 */
import type { ContentHit, RemoteResult } from './host.ts'

export type SearchStatus = 'idle' | 'pending' | 'done' | 'error'

/** What the switcher renders from. */
export interface SearchSnapshot {
  /** The trimmed query these results answer. */
  readonly query: string
  readonly status: SearchStatus
  readonly hits: readonly ContentHit[]
}

/** The host search call. */
export type SearchFn = (query: string, signal: AbortSignal) => Promise<RemoteResult<{ items: ContentHit[] }>>

export interface ContentSearchOptions {
  readonly search: SearchFn
  readonly delayMs?: number
  /** Shorter queries (after trimming) never reach the host. */
  readonly minLength?: number
  readonly setTimeout?: (fn: () => void, ms: number) => unknown
  readonly clearTimeout?: (handle: unknown) => void
  readonly onError?: (error: unknown) => void
}

export interface ContentSearch {
  update(query: string): void
  getSnapshot(): SearchSnapshot
  subscribe(listener: () => void): () => void
  /** Cancel the timer and the request in flight. */
  dispose(): void
}

const IDLE: SearchSnapshot = { query: '', status: 'idle', hits: [] }

/**
 * Whether a failure means the deployment has full-text search switched off
 * (`session-query-sqlite` with `openAt: never`). The Session Controller folds
 * the provider's `SESSION_QUERY_SEARCH_DISABLED` into a generic gateway error,
 * so the provider's message is the only signal that survives.
 */
export function isDisabled(message: string): boolean {
  return /SESSION_QUERY_SEARCH_DISABLED|search is disabled/i.test(message)
}

/**
 * Create a search controller.
 * @param options - the host call and timing.
 * @returns the controller.
 */
export function createContentSearch(options: ContentSearchOptions): ContentSearch {
  const delayMs = options.delayMs ?? 250
  const minLength = options.minLength ?? 2
  const schedule = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms))
  const cancel = options.clearTimeout ?? (handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))
  const listeners = new Set<() => void>()
  let snapshot = IDLE
  let timer: unknown
  let inflight: AbortController | undefined
  let disposed = false
  /** The host reported content search switched off; stop asking. */
  let unavailable = false

  const set = (next: SearchSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const stop = (): void => {
    if (timer !== undefined) cancel(timer)
    timer = undefined
    inflight?.abort()
    inflight = undefined
  }

  const run = async (query: string): Promise<void> => {
    const controller = new AbortController()
    inflight = controller
    let next: SearchSnapshot
    try {
      const result = await options.search(query, controller.signal)
      // The host reports a cancelled call as a failed result, not a throw.
      if (controller.signal.aborted) return
      if (result.ok) next = { query, status: 'done', hits: result.value.items }
      else if (isDisabled(result.error.message)) {
        unavailable = true
        next = IDLE
      } else {
        options.onError?.(new Error(result.error.message))
        next = { query, status: 'error', hits: [] }
      }
    } catch (error) {
      if (!controller.signal.aborted) options.onError?.(error)
      next = { query, status: 'error', hits: [] }
    }
    // Superseded or disposed: a newer query owns the snapshot now.
    if (controller.signal.aborted || inflight !== controller) return
    inflight = undefined
    set(next)
  }

  return {
    update(raw) {
      if (disposed || unavailable) return
      const query = raw.trim()
      if (query === snapshot.query && snapshot.status !== 'idle') return
      stop()
      if (query.length < minLength) {
        if (snapshot !== IDLE) set(IDLE)
        return
      }
      set({ query, status: 'pending', hits: [] })
      timer = schedule(() => {
        timer = undefined
        void run(query)
      }, delayMs)
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      disposed = true
      stop()
      listeners.clear()
    },
  }
}
