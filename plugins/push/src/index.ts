/**
 * dsh-plugin-push, node half.
 *
 * Two routes on the composition's `webServer`, behind the `connection`
 * service's Host/Origin fence and browser login:
 *
 * - `GET  /push/status` answers, for every registered workspace, how many
 *   commits it has to push.
 * - `POST /push/run` with `{ workspaceId }` runs `git pull` then `git push`
 *   in that workspace.
 *
 * The browser names workspaces by id only. Paths come from the host's
 * workspace registry, so a request cannot run git in an arbitrary directory.
 * @module dsh-plugin-push
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pullAndPush, pushStatus, type GitRunner, type PushResult, type PushStatus } from './git.ts'

export { failureText, pullAndPush, pushStatus, runGit } from './git.ts'
export type { GitOutput, GitRunner, PushResult, PushStatus } from './git.ts'

/** Stable Cordis plugin name. */
export const name = 'push'

/** Host services the routes need. */
export const inject = ['webServer', 'connection', 'workspaceRegistry']

export const STATUS_PATH = '/push/status'
export const RUN_PATH = '/push/run'

const MAX_BODY_BYTES = 16 * 1024

/** The registry slice this plugin reads. */
export interface RegistryLike {
  list(): readonly { readonly id: string, readonly path: string }[]
}

/**
 * Serializes runs per workspace and reports whether one is in flight, so a
 * double click or a second tab cannot start two pushes in one repository.
 */
export function createRunGate() {
  const running = new Set<string>()
  return {
    isRunning: (id: string) => running.has(id),
    /** Runs `task` unless `id` is already running. Returns undefined when it was. */
    async run<T>(id: string, task: () => Promise<T>): Promise<T | undefined> {
      if (running.has(id)) return undefined
      running.add(id)
      try {
        return await task()
      } finally {
        running.delete(id)
      }
    },
  }
}

/** One workspace row of the status response. */
export type WorkspaceStatus = PushStatus & { readonly workspaceId: string, readonly running: boolean }

/**
 * Status for every registered workspace, read in parallel.
 * @param registry - host workspace registry.
 * @param isRunning - whether a push is in flight for a workspace.
 * @param git - command runner.
 */
export async function statusAll(registry: RegistryLike, isRunning: (id: string) => boolean, git?: GitRunner): Promise<WorkspaceStatus[]> {
  return Promise.all(registry.list().map(async (workspace) => ({
    workspaceId: workspace.id,
    running: isRunning(workspace.id),
    ...(await pushStatus(workspace.path, git)),
  })))
}

/**
 * Validate one run body.
 * @param text - request body.
 * @returns the workspace id, or an error message.
 */
export function parseRunBody(text: string): { workspaceId: string } | string {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return 'body must be JSON'
  }
  if (typeof body !== 'object' || body === null) return 'body must be a JSON object'
  const { workspaceId } = body as { workspaceId?: unknown }
  if (typeof workspaceId !== 'string' || workspaceId === '') return '"workspaceId" must be a non-empty string'
  return { workspaceId }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

interface Services {
  webServer: { register(route: { kind: 'exact', path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }): () => void }
  connection: { requestRejection(req: IncomingMessage): number | undefined }
  workspaceRegistry: RegistryLike
}

/**
 * Host plugin body.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const { webServer, connection, workspaceRegistry } = ctx as unknown as Services
  const gate = createRunGate()

  const rejected = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = connection.requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }
  const allowOnly = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (req.method === method) return true
    res.statusCode = 405
    res.setHeader('allow', method)
    res.end()
    return false
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    handler: async (req, res) => {
      if (rejected(req, res) || !allowOnly(req, res, 'GET')) return
      sendJson(res, 200, { workspaces: await statusAll(workspaceRegistry, gate.isRunning) })
    },
  }), `push: GET ${STATUS_PATH}`)

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: RUN_PATH,
    handler: async (req, res) => {
      if (rejected(req, res) || !allowOnly(req, res, 'POST')) return
      if (String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        sendJson(res, 415, { ok: false, message: 'content-type must be application/json' })
        return
      }
      const text = await readBody(req).catch(() => null)
      if (text === null) {
        sendJson(res, 400, { ok: false, message: 'request body unreadable or too large' })
        return
      }
      const body = parseRunBody(text)
      if (typeof body === 'string') {
        sendJson(res, 400, { ok: false, message: body })
        return
      }
      const workspace = workspaceRegistry.list().find(entry => entry.id === body.workspaceId)
      if (workspace === undefined) {
        sendJson(res, 404, { ok: false, message: 'unknown workspace' })
        return
      }
      const result: PushResult | undefined = await gate.run(workspace.id, () => pullAndPush(workspace.path))
      if (result === undefined) {
        sendJson(res, 409, { ok: false, message: 'A push is already running for this workspace.' })
        return
      }
      sendJson(res, 200, { ...result, status: await pushStatus(workspace.path) })
    },
  }), `push: POST ${RUN_PATH}`)
}
