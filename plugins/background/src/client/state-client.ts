/**
 * Browser view of the shared library.
 *
 * Fetches `api/dsh-background.state` on start, on window focus, and every 30
 * seconds, so edits from another device arrive without a push channel. Local
 * edits apply optimistically with the same pure {@link applyOp} the host uses,
 * then post with the revision they were based on; a 409 means another device
 * saved first, so the client adopts the host's state and replays the op once.
 * Sends are serialized so each one carries the revision its predecessor
 * produced.
 * @module
 */
import { applyOp, emptyState, normalizeState, type Op, type State } from '../shared/state.ts'
import type { SourceInfo } from './pool.ts'

export const STATE_URL = 'api/dsh-background.state'
export const POLL_MS = 30_000

/** What the UI and controller read. */
export interface ClientSnapshot {
  status: 'loading' | 'ready' | 'error'
  state: State
  info: SourceInfo
  /** Last transport or host error, cleared on the next success. */
  error?: string
}

export type SendResult = { ok: true } | { ok: false; error: string }

/** The observable library client. */
export interface StateClient {
  getSnapshot(): ClientSnapshot
  subscribe(listener: () => void): () => void
  /** Re-read the host state now. */
  refresh(): Promise<void>
  /** Apply an op locally only (live preview); a later {@link send} persists it. */
  preview(op: Op): void
  /** Apply optimistically and persist. */
  send(op: Op): Promise<SendResult>
  /** Begin polling and focus refreshes; returns the stopper. */
  start(target?: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function normalizeInfo(raw: unknown): SourceInfo {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const folders = typeof record.folders === 'object' && record.folders !== null ? record.folders as SourceInfo['folders'] : {}
  const files = typeof record.files === 'object' && record.files !== null ? record.files as SourceInfo['files'] : {}
  return { folders, files }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    // fall through
  }
  return `HTTP ${response.status}`
}

/**
 * Create the client.
 * @param fetchImpl - transport (the page's fetch by default).
 * @returns the client; call `refresh()` or `start()` to load.
 */
export function createStateClient(fetchImpl: FetchLike = (i, init) => globalThis.fetch(i, init)): StateClient {
  let snapshot: ClientSnapshot = { status: 'loading', state: emptyState(), info: { folders: {}, files: {} } }
  /** Last state confirmed by the host; optimistic edits layer on top. */
  let confirmed: State = snapshot.state
  const listeners = new Set<() => void>()
  let queue: Promise<unknown> = Promise.resolve()

  const publish = (next: ClientSnapshot) => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const adopt = (body: unknown) => {
    const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    confirmed = normalizeState(record.state)
    publish({ status: 'ready', state: confirmed, info: normalizeInfo(body) })
  }

  const refresh = async () => {
    try {
      const response = await fetchImpl(STATE_URL, { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!response.ok) throw new Error(await readError(response))
      adopt(await response.json())
    } catch (error) {
      // Keep whatever is showing; only surface the failure.
      publish({ ...snapshot, status: snapshot.status === 'loading' ? 'error' : snapshot.status, error: String((error as Error).message ?? error) })
    }
  }

  const post = (op: Op, baseRevision: number) => fetchImpl(STATE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ baseRevision, op }),
  })

  const persist = async (op: Op): Promise<SendResult> => {
    try {
      let response = await post(op, confirmed.revision)
      if (response.status === 409) {
        adopt(await response.json())
        response = await post(op, confirmed.revision)
      }
      if (!response.ok) {
        const error = await readError(response)
        publish({ ...snapshot, state: confirmed, error })
        return { ok: false, error }
      }
      adopt(await response.json())
      return { ok: true }
    } catch (error) {
      const message = String((error as Error).message ?? error)
      publish({ ...snapshot, state: confirmed, error: message })
      return { ok: false, error: message }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    refresh,
    preview(op) {
      if (op.type === 'add') return
      publish({ ...snapshot, state: applyOp(snapshot.state, op) })
    },
    send(op) {
      // `add` needs host validation, so it is never applied optimistically.
      if (op.type !== 'add') publish({ ...snapshot, state: applyOp(snapshot.state, op) })
      const run = queue.then(() => persist(op))
      queue = run.catch(() => {})
      return run
    },
    start(target = globalThis as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>) {
      void refresh()
      const onFocus = () => { void refresh() }
      target.addEventListener('focus', onFocus)
      const timer = setInterval(() => { void refresh() }, POLL_MS)
      return () => {
        target.removeEventListener('focus', onFocus)
        clearInterval(timer)
      }
    },
  }
}
