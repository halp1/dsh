/**
 * Browser access to the host queue, plus one shared observable per Session
 * that the dock reads. A Session's list is fetched on first subscribe, on
 * window focus, every 30 s, after every mutation, and shortly after the next
 * item is due.
 * @module
 */
import { API, type AttachmentUpload, type CreateRequest, type PendingSend } from '../shared/types.ts'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Page-relative, like the host's own API calls, so a path-prefixed deployment still works. */
const url = (path: string) => path.slice(1)

export const POLL_MS = 30_000
const DUE_SLACK_MS = 2_000

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // fall through
  }
  return `HTTP ${response.status}`
}

export class ApiError extends Error {}

export interface Api {
  list(sessionId: string): Promise<PendingSend[]>
  create(request: CreateRequest): Promise<PendingSend>
  /** Remove an item; returns it with its attachment bytes. */
  cancel(id: string): Promise<{ item: PendingSend; attachments: AttachmentUpload[] }>
  sendNow(id: string): Promise<void>
  retry(id: string): Promise<void>
}

export function createApi(fetchImpl: FetchLike = (i, init) => globalThis.fetch(i, init)): Api {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(url(path), { cache: 'no-store', ...init, headers: { accept: 'application/json', ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }) } })
    if (!response.ok) throw new ApiError(await readError(response))
    return await response.json() as T
  }
  const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) })
  return {
    list: async (sessionId) => (await call<{ items: PendingSend[] }>(`${API.list}?sessionId=${encodeURIComponent(sessionId)}`)).items,
    create: async (request) => (await post<{ item: PendingSend }>(API.create, request)).item,
    cancel: (id) => post<{ item: PendingSend; attachments: AttachmentUpload[] }>(API.cancel, { id }),
    sendNow: async (id) => { await post(API.sendNow, { id }) },
    retry: async (id) => { await post(API.retry, { id }) },
  }
}

export interface SessionQueue {
  getSnapshot(): readonly PendingSend[]
  subscribe(listener: () => void): () => void
  refresh(): Promise<void>
  /** Show a change at once, before the host confirms it. */
  patch(mutate: (items: readonly PendingSend[]) => readonly PendingSend[]): void
}

const EMPTY: readonly PendingSend[] = []

/** One observable list per Session, polled while anything subscribes. */
export class QueueHub {
  private readonly queues = new Map<string, SessionQueue>()

  constructor(readonly api: Api, private readonly win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'> | undefined = typeof window === 'undefined' ? undefined : window) {}

  get(sessionId: string): SessionQueue {
    let queue = this.queues.get(sessionId)
    if (queue === undefined) {
      queue = this.make(sessionId)
      this.queues.set(sessionId, queue)
    }
    return queue
  }

  private make(sessionId: string): SessionQueue {
    const listeners = new Set<() => void>()
    let items = EMPTY
    let seq = 0
    let dueTimer: number | undefined
    let poll: number | undefined
    const win = this.win
    const api = this.api

    const emit = () => { for (const l of listeners) l() }
    const set = (next: readonly PendingSend[]) => {
      items = next.length === 0 ? EMPTY : next
      emit()
      if (win === undefined) return
      if (dueTimer !== undefined) win.clearTimeout(dueTimer)
      dueTimer = undefined
      const next1 = items.filter((i) => i.status === 'pending').map((i) => Date.parse(i.sendAt)).sort((a, b) => a - b)[0]
      if (next1 !== undefined && listeners.size > 0) {
        dueTimer = win.setTimeout(() => { void refresh() }, Math.min(POLL_MS, Math.max(0, next1 - Date.now()) + DUE_SLACK_MS))
      }
    }
    const refresh = async () => {
      const mine = ++seq
      try {
        const next = await api.list(sessionId)
        if (mine === seq) set(next)
      } catch {
        // keep what we have; the next poll retries
      }
    }
    const onFocus = () => { void refresh() }

    return {
      getSnapshot: () => items,
      refresh,
      patch: (mutate) => { seq++; set(mutate(items)) },
      subscribe: (listener) => {
        listeners.add(listener)
        if (listeners.size === 1) {
          void refresh()
          if (win !== undefined) {
            win.addEventListener('focus', onFocus)
            poll = win.setInterval(onFocus, POLL_MS)
          }
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0 && win !== undefined) {
            win.removeEventListener('focus', onFocus)
            if (poll !== undefined) win.clearInterval(poll)
            if (dueTimer !== undefined) win.clearTimeout(dueTimer)
            poll = undefined
            dueTimer = undefined
          }
        }
      },
    }
  }
}
