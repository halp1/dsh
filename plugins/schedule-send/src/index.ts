/**
 * dsh-plugin-schedule-send, node half.
 *
 * Holds the pending queue (a JSON file under the dsh home), fires a single
 * timer at the next due item, and delivers each message through the Session
 * Controller's `prompt`, the same path the composer uses. Messages arrive as
 * ordinary user messages, queued behind a running turn.
 *
 * Routes go through `connection.fetch` so they inherit the host's browser
 * authentication.
 * @module dsh-plugin-schedule-send
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { API, type PendingSend } from './shared/types.ts'
import { handleCancel, handleCreate, handleList, handleSendNow, type RouteDeps } from './node/routes.ts'
import { PermanentDeliveryError, Scheduler } from './node/scheduler.ts'
import { AttachmentStore, QueueStore, defaultQueueFile } from './node/store.ts'

export const name = 'schedule-send'

export interface Config {
  /** Where to keep the queue; defaults to `<dsh home>/plugins/schedule-send/queue.json`. */
  queueFile?: string
}

type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }
  | { type: 'file'; receiptId: string }

/** The slice of the Session Controller this plugin calls. */
export interface PromptService {
  prompt(request: {
    requestId: string
    sessionId: string
    mode: 'queue' | 'steer'
    content: readonly PromptPart[]
    clientTimeZone?: string
  }, signal: AbortSignal): Promise<unknown>
  resolveAgent(sessionId: string): Promise<{ agent: unknown } | { error: unknown }>
}

/** The slice of the host file upload service this plugin calls. */
export interface UploadService {
  upload(agent: unknown, request: { data: string; name?: string }, signal: AbortSignal): Promise<{ receiptId: string }>
}

export interface DeliveryDeps {
  controller: PromptService
  /** Absent in compositions without file uploads; items with files then fail. */
  uploads: UploadService | undefined
  readBlob(id: string, index: number): Promise<Uint8Array>
}

/** Errors no retry can fix: the session is gone, or the host refuses the content. */
const PERMANENT_CODES = new Set(['session/not-found', 'session/migration-required', 'session/attachment-invalid', 'subagent/attachment-invalid', 'gateway/bad-request'])

const permanentIfKnown = (error: unknown): unknown => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && PERMANENT_CODES.has(code)
    ? new PermanentDeliveryError(error instanceof Error ? error.message : code)
    : error
}

/**
 * Build the prompt content for one item: images inline as base64, other files
 * as receipts minted on the host for the target session.
 */
export async function buildContent(deps: DeliveryDeps, item: PendingSend, signal: AbortSignal): Promise<PromptPart[]> {
  const content: PromptPart[] = item.text === '' ? [] : [{ type: 'text', text: item.text }]
  const metas = item.attachments ?? []
  let agent: unknown
  for (const [index, meta] of metas.entries()) {
    let bytes: Uint8Array
    try {
      bytes = await deps.readBlob(item.id, index)
    } catch {
      throw new PermanentDeliveryError(`attachment ${meta.name || index + 1} is missing from disk`)
    }
    const data = Buffer.from(bytes).toString('base64')
    const name = meta.name === '' ? {} : { name: meta.name }
    if (meta.kind === 'image') {
      content.push({ type: 'image', mediaType: meta.mediaType, data, ...name })
      continue
    }
    if (deps.uploads === undefined) throw new PermanentDeliveryError('this host cannot accept file attachments')
    if (agent === undefined) {
      const resolved = await deps.controller.resolveAgent(item.sessionId)
      if ('error' in resolved) throw resolved.error
      agent = resolved.agent
    }
    const { receiptId } = await deps.uploads.upload(agent, { data, ...name }, signal)
    content.push({ type: 'file', receiptId })
  }
  return content
}

/**
 * Deliver one item through the controller, classifying errors retrying cannot fix.
 */
export async function deliverVia(deps: DeliveryDeps, item: PendingSend): Promise<void> {
  const signal = AbortSignal.timeout(120_000)
  try {
    const content = await buildContent(deps, item, signal)
    await deps.controller.prompt({
      requestId: item.id,
      sessionId: item.sessionId,
      mode: 'queue',
      content,
      ...(item.clientTimeZone === undefined ? {} : { clientTimeZone: item.clientTimeZone }),
    }, signal)
  } catch (error) {
    throw permanentIfKnown(error)
  }
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path
}

function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error)
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function apply(ctx: Context, config: Config | undefined): void {
  const logger = (ctx as unknown as { logger?: (name: string) => { warn(msg: string): void } }).logger?.('schedule-send')
  const warn = (message: string) => logger === undefined ? console.warn(message) : logger.warn(message)
  const file = typeof config?.queueFile === 'string' && config.queueFile.trim() !== ''
    ? resolve(expandHome(config.queueFile.trim()))
    : defaultQueueFile()
  const store = new QueueStore(file, warn)
  const blobs = new AttachmentStore(file)
  const loaded = store.load()
  let scheduler: Scheduler | undefined

  const deps: RouteDeps = {
    store,
    blobs,
    changed: () => scheduler?.arm(),
    drain: () => { void scheduler?.drain() },
  }

  const guard = (handler: (request: Request) => Response | Promise<Response>) => async (request: Request) => {
    try {
      await loaded
      return await handler(request)
    } catch (error) {
      return failure(error)
    }
  }

  // Deliveries need the controller; start the timer only once it exists.
  ctx.inject(['sessionController'], (ctx) => {
    const controller = ctx.get('sessionController') as unknown as PromptService
    ctx.effect(() => {
      const delivery: DeliveryDeps = {
        controller,
        // Optional: read at delivery time so a late-loading upload service still counts.
        get uploads() { return ctx.get('fileUploads') as UploadService | undefined },
        readBlob: (id, index) => blobs.read(id, index),
      }
      const instance = new Scheduler({
        store,
        deliver: (item) => deliverVia(delivery, item),
        delivered: (item) => blobs.remove(item.id),
        log: warn,
      })
      scheduler = instance
      void loaded.then(() => instance.drain())
      return async () => {
        if (scheduler === instance) scheduler = undefined
        await instance.dispose()
      }
    }, 'schedule-send: scheduler')
  })

  ctx.inject(['connection'], (ctx) => {
    const register = (ctx.get('connection') as HostConnectionHandle).fetch.register
    const route = (path: string, methods: string[], handler: (request: Request) => Response | Promise<Response>) =>
      ctx.effect(() => register({ path, methods, requestBody: 'buffered', fetch: guard(handler) } as never), `schedule-send: ${path}`)
    route(API.list, ['GET'], (r) => handleList(r, deps))
    route(API.create, ['POST'], (r) => handleCreate(r, deps))
    route(API.cancel, ['POST'], (r) => handleCancel(r, deps))
    route(API.sendNow, ['POST'], (r) => handleSendNow(r, deps))
    route(API.retry, ['POST'], (r) => handleSendNow(r, deps))
  })
}
