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
import { QueueStore, defaultQueueFile } from './node/store.ts'

export const name = 'schedule-send'

export interface Config {
  /** Where to keep the queue; defaults to `<dsh home>/plugins/schedule-send/queue.json`. */
  queueFile?: string
}

/** The slice of the Session Controller this plugin calls. */
interface PromptService {
  prompt(request: {
    requestId: string
    sessionId: string
    mode: 'queue' | 'steer'
    content: readonly { type: 'text'; text: string }[]
    clientTimeZone?: string
  }, signal: AbortSignal): Promise<unknown>
}

const PERMANENT_CODES = new Set(['session/not-found', 'session/migration-required'])

/**
 * Deliver one item through the controller, classifying errors retrying cannot fix.
 * @param controller - the Session Controller.
 * @param item - the due message.
 */
export async function deliverVia(controller: PromptService, item: PendingSend): Promise<void> {
  try {
    await controller.prompt({
      requestId: item.id,
      sessionId: item.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: item.text }],
      ...(item.clientTimeZone === undefined ? {} : { clientTimeZone: item.clientTimeZone }),
    }, AbortSignal.timeout(60_000))
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (typeof code === 'string' && PERMANENT_CODES.has(code)) {
      throw new PermanentDeliveryError(error instanceof Error ? error.message : code)
    }
    throw error
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
  const loaded = store.load()
  let scheduler: Scheduler | undefined

  const deps: RouteDeps = {
    store,
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
      const instance = new Scheduler({ store, deliver: (item) => deliverVia(controller, item), log: warn })
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
