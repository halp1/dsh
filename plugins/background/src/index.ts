/**
 * dsh-plugin-background, node half.
 *
 * Owns the shared background library (a JSON file under the dsh home) and
 * serves it to every connected browser through three exact Fetch routes on the
 * host's authenticated `/api` channel:
 *
 * - `GET  /api/dsh-background.state` — library + folder listings + file health
 * - `POST /api/dsh-background.state` — one `{ baseRevision, op }` mutation
 * - `GET  /api/dsh-background.file`  — image bytes for a local entry
 *
 * Routes go through `connection.fetch` rather than raw `webServer` routes so
 * they inherit the host's trust fence and browser authentication, which keeps
 * local files private even when dsh web is reachable from other machines.
 * @module dsh-plugin-background
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { resolve } from 'node:path'
import { FILE_PATH, STATE_PATH, handleFile, handleGetState, handlePostState, type RouteDeps } from './node/routes.ts'
import { expandHome } from './node/sources.ts'
import { StateStore, defaultStateFile } from './node/store.ts'

/** Stable Cordis plugin name. */
export const name = 'background'

/** Node config (the `background` row in the profile's cordis.patch.yml). */
export interface Config {
  /** Where to keep the library; defaults to `<dsh home>/plugins/background/state.json`. */
  stateFile?: string
}

function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error)
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Host plugin body.
 * @param ctx - plugin context.
 * @param config - optional `{ stateFile }`.
 */
export function apply(ctx: Context, config: Config | undefined): void {
  const logger = (ctx as unknown as { logger?: (name: string) => { warn(msg: string): void } }).logger?.('background')
  const file = typeof config?.stateFile === 'string' && config.stateFile.trim() !== ''
    ? resolve(expandHome(config.stateFile.trim()))
    : defaultStateFile()
  const store = new StateStore(file, (message) => logger === undefined ? console.warn(message) : logger.warn(message))
  const deps: RouteDeps = { store }
  const loaded = store.load()

  const guard = (handler: (request: Request) => Promise<Response>) => async (request: Request) => {
    try {
      await loaded
      return await handler(request)
    } catch (error) {
      return failure(error)
    }
  }

  // `connection` exists only in web compositions; wait for it rather than
  // listing it in `inject`, so a headless profile still loads this row.
  ctx.inject(['connection'], (ctx) => {
    const register = (ctx.get('connection') as HostConnectionHandle).fetch.register
    ctx.effect(() => register({
      path: STATE_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: guard((request) => request.method === 'POST' ? handlePostState(request, deps) : handleGetState(deps)),
    }), `background: ${STATE_PATH}`)
    ctx.effect(() => register({
      path: FILE_PATH,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: guard((request) => handleFile(request, deps)),
    }), `background: ${FILE_PATH}`)
  })
}
