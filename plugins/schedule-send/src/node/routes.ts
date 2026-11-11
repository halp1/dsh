/**
 * The `/api/dsh-schedule-send.*` handlers as plain `(Request) => Response`
 * functions. The host's connection layer runs them after its own trust and
 * authentication checks.
 * @module
 */
import { randomUUID } from 'node:crypto'
import { MAX_AHEAD_MS, MAX_TEXT, PAST_GRACE_MS, type PendingSend } from '../shared/types.ts'
import type { QueueStore } from './store.ts'

export interface RouteDeps {
  store: QueueStore
  /** Called after any change so the scheduler re-arms. */
  changed: () => void
  /** Deliver due items now. */
  drain: () => void
  now?: () => number
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const bad = (error: string) => json({ error }, 400)
const missing = () => json({ error: 'not found' }, 404)

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const sorted = (items: readonly PendingSend[]) => [...items].sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt))

/** `GET list?sessionId=` */
export function handleList(request: Request, deps: RouteDeps): Response {
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  if (sessionId === null || sessionId === '') return bad('sessionId is required')
  return json({ items: sorted(deps.store.current.filter((item) => item.sessionId === sessionId)) })
}

/** `POST create` with `{ sessionId, text, sendAt, clientTimeZone? }` */
export async function handleCreate(request: Request, deps: RouteDeps): Promise<Response> {
  const input = await body(request)
  if (input === null) return bad('expected a JSON object')
  const { sessionId, text, sendAt, clientTimeZone } = input
  if (typeof sessionId !== 'string' || sessionId === '') return bad('sessionId is required')
  if (typeof text !== 'string' || text.trim() === '') return bad('message is empty')
  if (text.length > MAX_TEXT) return bad('message is too long')
  if (typeof sendAt !== 'string') return bad('sendAt is required')
  const at = Date.parse(sendAt)
  if (Number.isNaN(at)) return bad('sendAt is not a valid time')
  const now = deps.now?.() ?? Date.now()
  if (at < now - PAST_GRACE_MS) return bad('that time has passed')
  if (at > now + MAX_AHEAD_MS) return bad('that time is more than a year away')
  if (clientTimeZone !== undefined && (typeof clientTimeZone !== 'string' || !validTimeZone(clientTimeZone))) {
    return bad('clientTimeZone is not a valid time zone')
  }
  const item: PendingSend = {
    id: randomUUID(),
    sessionId,
    text: text.trim(),
    sendAt: new Date(at).toISOString(),
    ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
    createdAt: new Date(now).toISOString(),
    status: 'pending',
    attempts: 0,
  }
  await deps.store.update((items) => [...items, item])
  deps.changed()
  return json({ item })
}

async function withId(request: Request): Promise<string | null> {
  const input = await body(request)
  return typeof input?.id === 'string' && input.id !== '' ? input.id : null
}

/** `POST cancel` with `{ id }`. Returns the removed item so the client can restore its text. */
export async function handleCancel(request: Request, deps: RouteDeps): Promise<Response> {
  const id = await withId(request)
  if (id === null) return bad('id is required')
  const item = deps.store.current.find((c) => c.id === id)
  if (item === undefined) return missing()
  await deps.store.update((items) => items.filter((c) => c.id !== id))
  deps.changed()
  return json({ item })
}

/**
 * `POST send-now` and `POST retry` with `{ id }`: make the item due now as a
 * fresh pending attempt, then deliver.
 */
export async function handleSendNow(request: Request, deps: RouteDeps): Promise<Response> {
  const id = await withId(request)
  if (id === null) return bad('id is required')
  if (!deps.store.current.some((c) => c.id === id)) return missing()
  const now = new Date(deps.now?.() ?? Date.now()).toISOString()
  const items = await deps.store.update((all) => all.map((c) => {
    if (c.id !== id) return c
    const { lastError: _dropped, ...rest } = c
    return { ...rest, sendAt: now, status: 'pending' as const, attempts: 0 }
  }))
  deps.drain()
  return json({ item: items.find((c) => c.id === id) })
}
