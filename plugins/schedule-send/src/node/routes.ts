/**
 * The `/api/dsh-schedule-send.*` handlers as plain `(Request) => Response`
 * functions. The host's connection layer runs them after its own trust and
 * authentication checks.
 * @module
 */
import { randomUUID } from 'node:crypto'
import {
  IMAGE_TYPES, MAX_AHEAD_MS, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_TEXT, PAST_GRACE_MS,
  type AttachmentMeta, type PendingSend,
} from '../shared/types.ts'
import type { AttachmentStore, QueueStore } from './store.ts'

export interface RouteDeps {
  store: QueueStore
  blobs: AttachmentStore
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

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Validate and decode the request's attachments. */
function parseAttachments(raw: unknown): { metas: AttachmentMeta[]; blobs: Buffer[] } | string {
  if (raw === undefined) return { metas: [], blobs: [] }
  if (!Array.isArray(raw)) return 'attachments must be a list'
  if (raw.length > MAX_ATTACHMENTS) return `at most ${MAX_ATTACHMENTS} attachments`
  const metas: AttachmentMeta[] = []
  const blobs: Buffer[] = []
  let total = 0
  for (const entry of raw as unknown[]) {
    const a = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    if (a.kind !== 'image' && a.kind !== 'file') return 'attachment kind must be image or file'
    if (typeof a.data !== 'string' || a.data.length % 4 !== 0 || !BASE64.test(a.data)) return 'attachment data must be base64'
    const name = typeof a.name === 'string' ? a.name.slice(0, 255) : ''
    const mediaType = typeof a.mediaType === 'string' ? a.mediaType : ''
    if (a.kind === 'image' && !IMAGE_TYPES.includes(mediaType)) return `unsupported image type ${mediaType || '(none)'}`
    const blob = Buffer.from(a.data, 'base64')
    total += blob.byteLength
    if (total > MAX_ATTACHMENT_BYTES) return 'attachments are too large'
    metas.push({ kind: a.kind, name, mediaType, size: blob.byteLength })
    blobs.push(blob)
  }
  return { metas, blobs }
}

/** `POST create` with `{ sessionId, text, attachments?, sendAt, clientTimeZone? }` */
export async function handleCreate(request: Request, deps: RouteDeps): Promise<Response> {
  const input = await body(request)
  if (input === null) return bad('expected a JSON object')
  const { sessionId, text, sendAt, clientTimeZone } = input
  if (typeof sessionId !== 'string' || sessionId === '') return bad('sessionId is required')
  if (typeof text !== 'string') return bad('text is required')
  if (text.length > MAX_TEXT) return bad('message is too long')
  const attachments = parseAttachments(input.attachments)
  if (typeof attachments === 'string') return bad(attachments)
  if (text.trim() === '' && attachments.metas.length === 0) return bad('message is empty')
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
    ...(attachments.metas.length === 0 ? {} : { attachments: attachments.metas }),
    sendAt: new Date(at).toISOString(),
    ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
    createdAt: new Date(now).toISOString(),
    status: 'pending',
    attempts: 0,
  }
  // Bytes land before the queue row, so the scheduler never sees an item without them.
  if (attachments.blobs.length > 0) await deps.blobs.write(item.id, attachments.blobs)
  try {
    await deps.store.update((items) => [...items, item])
  } catch (error) {
    await deps.blobs.remove(item.id).catch(() => {})
    throw error
  }
  deps.changed()
  return json({ item })
}

async function withId(request: Request): Promise<string | null> {
  const input = await body(request)
  return typeof input?.id === 'string' && input.id !== '' ? input.id : null
}

/**
 * `POST cancel` with `{ id }`. Returns the removed item, with each attachment's
 * base64 bytes, so the client can put the whole message back in the draft.
 */
export async function handleCancel(request: Request, deps: RouteDeps): Promise<Response> {
  const id = await withId(request)
  if (id === null) return bad('id is required')
  const item = deps.store.current.find((c) => c.id === id)
  if (item === undefined) return missing()
  const data = await Promise.all((item.attachments ?? []).map((_, i) => deps.blobs.read(id, i).then((b) => b.toString('base64'), () => undefined)))
  await deps.store.update((items) => items.filter((c) => c.id !== id))
  await deps.blobs.remove(id).catch(() => {})
  deps.changed()
  const attachments = (item.attachments ?? []).flatMap((meta, i) => data[i] === undefined ? [] : [{ ...meta, data: data[i] }])
  return json({ item, attachments })
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
