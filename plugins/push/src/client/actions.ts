/**
 * The two host calls: read every status, and run one pull and push.
 * @module
 */
import type { PushStore, WorkspaceStatus } from './store.ts'

const STATUS_ROUTE = 'push/status'
const RUN_ROUTE = 'push/run'

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Read every workspace's status into the store.
 * @returns false when the host could not answer.
 */
export async function refreshStatus(store: PushStore, fetcher: Fetcher): Promise<boolean> {
  try {
    const response = await fetcher(STATUS_ROUTE, { headers: { accept: 'application/json' } })
    if (!response.ok) return false
    const payload = await response.json() as { workspaces?: unknown }
    if (!Array.isArray(payload.workspaces)) return false
    store.setAll(payload.workspaces as WorkspaceStatus[])
    return true
  } catch {
    return false
  }
}

/**
 * Run one pull and push, reporting the outcome through the store.
 * @param store - browser state.
 * @param fetcher - document-relative fetch.
 * @param workspaceId - workspace to push.
 */
export async function runPush(store: PushStore, fetcher: Fetcher, workspaceId: string): Promise<void> {
  if (store.button(workspaceId).running) return
  store.setRunning(workspaceId, true)
  try {
    const response = await fetcher(RUN_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ workspaceId }),
    })
    const payload = await response.json().catch(() => ({})) as {
      ok?: boolean
      step?: 'pull' | 'push'
      message?: string
      status?: Omit<WorkspaceStatus, 'workspaceId' | 'running'>
    }
    if (payload.status !== undefined) store.setOne({ ...payload.status, workspaceId, running: false } as WorkspaceStatus)
    if (response.ok && payload.ok === true) {
      store.notify('success', 'Pushed')
      return
    }
    const step = payload.step === 'pull' ? 'git pull failed' : payload.step === 'push' ? 'git push failed' : 'Push failed'
    store.notify('error', `${step}: ${payload.message ?? `HTTP ${response.status}`}`)
  } catch (error) {
    store.notify('error', `Push failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    store.setRunning(workspaceId, false)
  }
}
