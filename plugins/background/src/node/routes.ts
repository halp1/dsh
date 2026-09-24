/**
 * The three `/api/dsh-background.*` handlers, written as plain
 * `(Request) => Response` functions so they test without a server. The host's
 * connection layer runs them after its own trust and authentication checks.
 *
 * The file route never takes a path from the request: it takes an entry id
 * and an index, and resolves them against the stored library.
 * @module
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { applyOp, newEntryId, normalizeOp, type Entry, type State } from '../shared/state.ts'
import { SourceError, contentTypeFor, listFolderImages, resolveSource, servablePath } from './sources.ts'
import type { StateStore } from './store.ts'

export const STATE_PATH = '/api/dsh-background.state'
export const FILE_PATH = '/api/dsh-background.file'

/** What the handlers need from the plugin. */
export interface RouteDeps {
  store: StateStore
}

/** Per-folder listing summary, or why it failed. */
export type FolderInfo = { count: number; names: string[] } | { error: string }

/** Freshly computed facts about the local sources. */
export interface SourceInfo {
  folders: Record<string, FolderInfo>
  files: Record<string, { ok: boolean }>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * List every folder and check every file entry.
 * @param state - the library.
 * @returns folder listings and file health, keyed by entry id.
 */
export async function describeSources(state: State): Promise<SourceInfo> {
  const info: SourceInfo = { folders: {}, files: {} }
  await Promise.all(state.entries.map(async (entry) => {
    if (entry.kind === 'folder') {
      try {
        const images = await listFolderImages(entry.source)
        info.folders[entry.id] = images.length === 0
          ? { error: 'no images' }
          : { count: images.length, names: images.map((p) => basename(p)) }
      } catch {
        info.folders[entry.id] = { error: 'cannot be read' }
      }
    } else if (entry.kind === 'file') {
      info.files[entry.id] = { ok: (await servablePath(entry.source)) !== undefined }
    }
  }))
  return info
}

async function snapshot(state: State): Promise<{ state: State } & SourceInfo> {
  return { state, ...(await describeSources(state)) }
}

/**
 * `GET /api/dsh-background.state`.
 * @param deps - the store.
 * @returns `{ state, folders, files }`.
 */
export async function handleGetState(deps: RouteDeps): Promise<Response> {
  return json(await snapshot(deps.store.current))
}

class StaleError extends Error {}

/**
 * `POST /api/dsh-background.state` with `{ baseRevision, op }`.
 * @param request - the posted request.
 * @param deps - the store.
 * @returns the new snapshot; 400 for bad input, 409 `{ error: 'stale', ... }` when `baseRevision` is behind.
 */
export async function handlePostState(request: Request, deps: RouteDeps): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'body is not JSON' }, 400)
  }
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const baseRevision = record.baseRevision
  const op = normalizeOp(record.op)
  if (typeof baseRevision !== 'number' || op === undefined) return json({ error: 'expected { baseRevision, op }' }, 400)

  // Validate an added source before entering the write queue: it touches the
  // filesystem and its failure must not consume a revision.
  let added: Entry | undefined
  if (op.type === 'add') {
    try {
      const { kind, source } = await resolveSource(op.source)
      added = { id: newEntryId(), kind, source, ...(op.label === undefined ? {} : { label: op.label }), inRotation: true }
    } catch (error) {
      if (error instanceof SourceError) return json({ error: error.message }, 400)
      throw error
    }
  }

  try {
    const saved = await deps.store.update((current) => {
      if (current.revision !== baseRevision) throw new StaleError()
      return applyOp(current, op, added)
    })
    return json(await snapshot(saved))
  } catch (error) {
    if (error instanceof StaleError) return json({ error: 'stale', ...(await snapshot(deps.store.current)) }, 409)
    throw error
  }
}

async function resolveFile(url: URL, state: State): Promise<string | undefined> {
  const id = url.searchParams.get('entry')
  const entry = state.entries.find((e) => e.id === id)
  if (entry === undefined) return undefined
  if (entry.kind === 'file') return servablePath(entry.source)
  if (entry.kind !== 'folder') return undefined
  const raw = url.searchParams.get('i')
  if (raw === null || !/^\d+$/.test(raw)) return undefined
  const images = await listFolderImages(entry.source).catch(() => [])
  const candidate = images[Number(raw)]
  return candidate === undefined ? undefined : servablePath(candidate, entry.source)
}

/**
 * `GET|HEAD /api/dsh-background.file?entry=<id>&i=<index>`.
 * @param request - the request.
 * @param deps - the store.
 * @returns the image bytes, 304 on a matching ETag, or 404.
 */
export async function handleFile(request: Request, deps: RouteDeps): Promise<Response> {
  const path = await resolveFile(new URL(request.url), deps.store.current)
  if (path === undefined) return new Response('not found', { status: 404 })
  const info = await stat(path)
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
  const headers = {
    'content-type': contentTypeFor(path),
    'content-length': String(info.size),
    'cache-control': 'private, max-age=300',
    etag,
    // SVGs are served from the app origin; never let one run script.
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff',
  }
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
  return new Response(stream, { status: 200, headers })
}
