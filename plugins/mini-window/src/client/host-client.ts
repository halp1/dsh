import { defaultState } from '../../shared/state.mjs'
export type MiniState = ReturnType<typeof defaultState>
export interface ModelCatalog { default?: NonNullable<MiniState['defaultModel']>; groups: ReadonlyArray<{ id: string; name: string; models: ReadonlyArray<{ id: string; name: string; description?: string; reasoning?: { defaultEffort?: string; efforts: ReadonlyArray<{ id: string; name: string; description?: string }> } }> }>; failures?: ReadonlyArray<{ id: string; name: string; message: string }> }
export interface RuntimeState { status: 'stopped' | 'starting' | 'ready' | 'error'; visible: boolean; expanded: boolean; shortcutRegistered: boolean; error?: string }
export interface HostSnapshot { state: MiniState; runtime: RuntimeState; error?: string; loading?: boolean; viewed?: Readonly<Record<string, number>> }
export interface NativeBridge {
  version: number
  hide(): Promise<unknown>
  setExpanded(expanded: boolean): Promise<unknown>
  getState(): Promise<{ expanded: boolean; visible: boolean }>
  drag?(phase: 'start' | 'end'): Promise<unknown>
  onState(listener: (state: { expanded: boolean; visible: boolean }) => void): () => void
  onCommand(listener: (command: 'new-chat' | 'open-settings') => void): () => void
}
declare global { interface Window { dshMiniWindow?: NativeBridge } }
const stateUrl = 'api/dsh-mini-window.state'
export class HostClient {
  private snapshot: HostSnapshot = { state: defaultState(), runtime: { status: 'stopped', visible: false, expanded: false, shortcutRegistered: false }, loading: true }
  private listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private lifetime = new AbortController()
  private fetcher: typeof fetch
  private catalogLoader?: () => Promise<ModelCatalog>
  constructor(fetcher: typeof fetch = (...args) => fetch(...args), catalogLoader?: () => Promise<ModelCatalog>) { this.fetcher = fetcher; this.catalogLoader = catalogLoader }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private adopt = (body: HostSnapshot) => { if (this.lifetime.signal.aborted) return; const state = body.state.revision < this.snapshot.state.revision ? this.snapshot.state : body.state; this.snapshot = { ...body, state, loading: false }; this.listeners.forEach(fn => fn()) }
  private async request(url: string, init?: RequestInit) {
    const response = await this.fetcher(url, { ...init, signal: this.lifetime.signal, cache: 'no-store', headers: { 'content-type': 'application/json', ...init?.headers } })
    let body: HostSnapshot
    try { body = await response.json() as HostSnapshot }
    catch { throw new Error(response.status === 404 ? 'The mini-window backend needs updating. Restart your existing DSH server, then reopen the window.' : `The mini-window backend returned an unreadable response (HTTP ${response.status}).`) }
    if (body.state && body.runtime) this.adopt(body)
    return { response, body }
  }
  refresh = async () => {
    try { const { response, body } = await this.request(stateUrl); if (!response.ok) throw new Error(body.error ?? `Settings could not load (HTTP ${response.status}).`) }
    catch (error) { if (!this.lifetime.signal.aborted) this.adopt({ ...this.snapshot, error: error instanceof Error ? error.message : String(error) }) }
  }
  patch = (patch: Record<string, unknown>): Promise<void> => {
    const run = this.queue.then(async () => {
      if (this.snapshot.loading) await this.refresh()
      for (let attempt = 0; attempt < 3; attempt++) {
        const { response, body } = await this.request(stateUrl, { method: 'POST', body: JSON.stringify({ baseRevision: this.snapshot.state.revision, patch }) })
        if (response.status === 409) continue
        if (!response.ok) throw new Error(body.error ?? body.runtime?.error ?? `Settings were not saved (HTTP ${response.status}).`)
        return
      }
      throw new Error('Settings changed in another window. Try saving again.')
    })
    this.queue = run.catch(() => {})
    return run
  }
  command = async (command: 'show' | 'hide' | 'restart' | 'quit') => {
    const { response, body } = await this.request('api/dsh-mini-window.command', { method: 'POST', body: JSON.stringify({ command }) })
    if (!response.ok) throw new Error(body.error ?? body.runtime?.error ?? 'The companion could not complete that action.')
  }
  waitForSaves = () => this.queue
  markViewed = async (sessionId: string) => {
    const { response, body } = await this.request('api/dsh-mini-window.viewed', { method: 'POST', body: JSON.stringify({ sessionId }) })
    if (!response.ok) throw new Error(body.error ?? 'Could not record the viewed session.')
  }
  models = async (): Promise<ModelCatalog> => {
    if (this.catalogLoader) return this.catalogLoader()
    const { response, body } = await this.request('api/dsh-mini-window.models')
    if (!response.ok) throw new Error(body.error ?? 'Available models could not load. Try refreshing them.')
    return body as unknown as ModelCatalog
  }
  createChat = async (workspaceId: string | null): Promise<string> => {
    const { response, body } = await this.request('api/dsh-mini-window.chat', { method: 'POST', body: JSON.stringify({ workspaceId }) })
    if (!response.ok) throw new Error(body.error ?? 'The mini chat could not be created.')
    const id = (body as unknown as { sessionId?: string }).sessionId
    if (typeof id !== 'string' || !id || id.length > 256) throw new Error('The mini chat did not return a session identifier.')
    return id
  }
  start = () => {
    void this.refresh()
    const focus = () => { void this.refresh() }
    window.addEventListener('focus', focus)
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void this.refresh() }, 5000)
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); this.lifetime.abort(); this.listeners.clear() }
  }
}
export function previewBridge(): NativeBridge {
  let state = { expanded: new URLSearchParams(location.search).get('miniMode') !== 'compact', visible: true }
  const listeners = new Set<(value: typeof state) => void>()
  return { version: 1, getState: async () => state, hide: async () => {}, setExpanded: async expanded => { state = { expanded, visible: true }; listeners.forEach(fn => fn(state)) }, onState: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, onCommand: () => () => {} }
}
