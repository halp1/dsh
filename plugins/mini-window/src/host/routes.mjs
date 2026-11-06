import { RequestError } from './controller.mjs'
import { sanitizeError } from './runtime.mjs'

export const STATE_PATH = '/api/dsh-mini-window.state'
export const COMMAND_PATH = '/api/dsh-mini-window.command'
export const VIEWED_PATH = '/api/dsh-mini-window.viewed'
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
async function body(request) {
  try { return await request.json() } catch { throw new RequestError(400, 'Expected a JSON request body.') }
}
export function createRoutes(controller, models) {
  const guard = (handler) => async (request) => {
    try { return await handler(request) }
    catch (error) {
      const status = error instanceof RequestError ? error.status : 503
      const message = sanitizeError(error, controller.native.secretURL)
      if (!(error instanceof RequestError)) controller.native.runtime = { ...controller.native.runtime, error: message }
      return json({ ...controller.snapshot(), error: message }, status)
    }
  }
  return [
    { path: STATE_PATH, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: guard(async request => {
      if (request.method === 'GET') return json(await controller.get())
      const result = await controller.mutate(await body(request))
      return json(result.snapshot, result.status)
    }) },
    { path: COMMAND_PATH, methods: ['POST'], requestBody: 'buffered', fetch: guard(async request => json(await controller.command(await body(request)))) },
    { path: VIEWED_PATH, methods: ['POST'], requestBody: 'buffered', fetch: guard(async request => json(controller.markViewed(await body(request)))) },
    ...(models ? [
      { path: '/api/dsh-mini-window.models', methods: ['GET'], requestBody: 'buffered', fetch: guard(async () => json(await models.catalog())) },
      { path: '/api/dsh-mini-window.chat', methods: ['POST'], requestBody: 'buffered', fetch: guard(async request => json(await models.create(await body(request)))) },
    ] : []),
  ]
}
