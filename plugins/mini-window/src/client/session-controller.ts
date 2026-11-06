import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { HostClient } from './host-client.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' { interface SessionReferenceSourceMap { miniChat: unknown } }
export interface Selection { reference: SessionReference | null; workspaceId: WorkspaceId | null; busy: boolean; initialized: boolean; error: string | null }
export class MiniSessions {
  private value: Selection = { reference: null, workspaceId: null, busy: false, initialized: false, error: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private disposed = false
  private initializePromise: Promise<void> | null = null
  private lifetime = new AbortController()
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly uiWorkspace: UiWorkspace
  readonly host: HostClient
  constructor(sessions: ISessions, workspaces: IWorkspaces, uiWorkspace: UiWorkspace, host: HostClient) { this.sessions = sessions; this.workspaces = workspaces; this.uiWorkspace = uiWorkspace; this.host = host }
  getSnapshot = () => this.value
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private publish(patch: Partial<Selection>) { if (!this.disposed) { this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()) } }
  private workspaceFor(id: SessionId) { return this.workspaces.list.getSnapshot().items.find(w => w.sessionIds.includes(id))?.workspaceId ?? null }
  initialize = (): Promise<void> => {
    if (this.initializePromise) return this.initializePromise
    this.initializePromise = (async () => {
      this.publish({ busy: true, initialized: false, error: null })
      await this.host.refresh()
      if (this.host.getSnapshot().error) throw new Error(this.host.getSnapshot().error)
      await this.sessions.refresh()
      await Promise.all([waitForReady(this.sessions.list, this.lifetime.signal), waitForReady(this.workspaces.list, this.lifetime.signal)])
      const stored = this.host.getSnapshot().state
      const workspaces = this.workspaces.list.getSnapshot().items
      const workspaceId = workspaces.find(w => w.workspaceId === stored.lastWorkspaceId)?.workspaceId ?? workspaces[0]?.workspaceId ?? null
      this.publish({ workspaceId })
      const lastId = stored.lastSessionId as SessionId | null
      if (lastId && this.sessions.list.getSnapshot().byId[lastId] && !this.workspaces.list.getSnapshot().archivedSessionIds.includes(lastId)) {
        const opened = await this.open(lastId)
        if (!opened && workspaceId) await this.newChat(workspaceId, true)
      } else if (workspaceId) await this.newChat(workspaceId, true)
      this.publish({ initialized: true, busy: false })
    })().catch(error => { this.publish({ initialized: true, busy: false, error: message(error) }); this.initializePromise = null })
    return this.initializePromise
  }
  open = async (id: SessionId, workspaceHint?: WorkspaceId | null): Promise<boolean> => {
    if (this.disposed) return false
    const generation = ++this.generation
    this.publish({ busy: true, error: null })
    let reference: SessionReference | undefined
    try {
      reference = this.sessions.retain(id, { source: 'miniChat' })
      await reference.ready
      if (this.disposed || generation !== this.generation) { reference.release(); return false }
      const old = this.value.reference
      const workspaceId = workspaceHint !== undefined ? workspaceHint : this.workspaceFor(id)
      this.publish({ reference, workspaceId, busy: false })
      // Defer releasing the old editor scope until React replaces its mounted tree.
      if (old && old !== reference) queueMicrotask(() => old.release())
      void this.host.patch({ lastSessionId: id, lastWorkspaceId: workspaceId }).catch(error => this.publish({ error: `Chat opened, but could not remember it: ${message(error)}` }))
      return true
    } catch (error) {
      reference?.release()
      if (generation === this.generation) this.publish({ busy: false, error: message(error) })
      return false
    }
  }
  newChat = async (workspaceId: WorkspaceId | null = this.value.workspaceId, reuseBlank = false): Promise<boolean> => {
    if (this.disposed) return false
    const generation = ++this.generation
    this.publish({ busy: true, error: null })
    try {
      // Another window may have saved defaults since our last focus/poll. Wait
      // for our own queued saves and read the server before choosing a route.
      await this.host.waitForSaves?.()
      await this.host.refresh()
      if (this.host.getSnapshot().error) throw new Error(this.host.getSnapshot().error)
      if (this.disposed || generation !== this.generation) return false
      // Never reuse a main-window blank when mini defaults are configured. Seed a
      // distinct canonical session before the normal DSH agent is opened.
      const configured = this.host.getSnapshot().state.defaultModel != null
      const id = configured ? await this.host.createChat(workspaceId) as SessionId : reuseBlank && workspaceId ? await this.uiWorkspace.connectWorkspace(workspaceId) : await this.sessions.create(workspaceId ? { workspaceId } : {})
      if (configured) await this.sessions.refresh()
      if (this.disposed || generation !== this.generation) return false
      return await this.open(id, workspaceId)
    } catch (error) { if (generation === this.generation) this.publish({ busy: false, error: message(error) }); return false }
  }
  clearError = () => this.publish({ error: null })
  dispose = () => { this.disposed = true; this.lifetime.abort(); this.generation++; this.value.reference?.release(); this.listeners.clear() }
}
export function waitForReady(source: { getSnapshot(): { phase: string }; subscribe(listener: () => void): () => void }, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Mini window closed.'))
  if (source.getSnapshot().phase === 'ready') return Promise.resolve()
  return new Promise((resolve, reject) => {
    let off = () => {}
    const finish = (error?: Error) => { clearTimeout(timer); off(); signal.removeEventListener('abort', abort); error ? reject(error) : resolve() }
    const check = () => { if (source.getSnapshot().phase === 'ready') finish() }
    const abort = () => finish(new Error('Mini window closed.'))
    const timer = setTimeout(() => finish(new Error('Workspaces are still connecting. Reopen the mini window to retry.')), 15000)
    off = source.subscribe(check)
    signal.addEventListener('abort', abort, { once: true })
    check()
  })
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
