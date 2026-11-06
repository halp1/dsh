import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type KeyboardEvent } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MiniSessions } from './session-controller.ts'
import { message } from './session-controller.ts'
import type { HostClient, NativeBridge } from './host-client.ts'
import { ModelDefaults } from './model-defaults.tsx'

export function Icon({ name }: { name: 'close' | 'plus' | 'history' | 'expand' | 'collapse' | 'settings' | 'chevron' | 'search' | 'arrow' }) {
  const paths = { close: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', history: 'M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2', expand: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5', collapse: 'M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3', settings: 'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', chevron: 'M7 10l5 5 5-5', search: 'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', arrow: 'M5 12h14M13 6l6 6-6 6' }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
export function IconButton({ label, icon, onClick, disabled, children }: { label: string; icon: Parameters<typeof Icon>[0]['name']; onClick: () => void; disabled?: boolean; children?: ReactNode }) {
  return <button className="dshmini-icon" type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}><Icon name={icon} />{children}</button>
}
export function Settings({ client, close }: { client: HostClient; close?: () => void }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const [shortcut, setShortcut] = useState(snapshot.state.shortcut)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setShortcut(snapshot.state.shortcut) }, [snapshot.state.shortcut])
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setError(null); setSaved(false); try { await work(); setSaved(true) } catch (e) { setError(message(e)) } finally { setBusy(false) } }
  const status = snapshot.runtime.status === 'ready' ? snapshot.runtime.shortcutRegistered ? 'Ready · global shortcut registered' : 'Ready · shortcut unavailable' : snapshot.runtime.status === 'starting' ? 'Starting companion…' : snapshot.runtime.status === 'error' ? 'Companion needs attention' : 'Companion stopped'
  return <div className="dshmini-settings">
    <div className="dshmini-settings-heading"><h2>Mini Window</h2>{close && <IconButton label="Close settings" icon="close" onClick={close} />}</div>
    <p className="dshmini-muted">Keep DSH within reach while you work in another app.</p>
    <label className="dshmini-toggle"><span><strong>Enable mini window</strong><small>Runs a hidden macOS companion while DSH is running.</small></span><input type="checkbox" checked={snapshot.state.enabled} disabled={busy || snapshot.loading} onChange={e => void run(() => client.patch({ enabled: e.target.checked }))} /></label>
    <form onSubmit={e => { e.preventDefault(); void run(() => client.patch({ shortcut: shortcut.trim() })) }}>
      <label className="dshmini-field">Global show/hide shortcut<input spellCheck={false} value={shortcut} disabled={busy || snapshot.loading} onChange={e => { setShortcut(e.target.value); setSaved(false) }} placeholder="Command+Shift+Space" /></label>
      <p className="dshmini-muted">Use names such as Command, Shift, Option, and Space. Occupied shortcuts leave your previous binding unchanged.</p>
      <button className="dshmini-button dshmini-primary" type="submit" disabled={busy || shortcut.trim() === snapshot.state.shortcut}>Save shortcut</button>
    </form>
    <ModelDefaults client={client} />
    <div className="dshmini-runtime"><span className={`dshmini-dot ${snapshot.runtime.status === 'ready' && snapshot.runtime.shortcutRegistered ? 'is-ready' : ''}`} /><span role="status">{status}</span></div>
    {(error ?? snapshot.error ?? snapshot.runtime.error) && <p className="dshmini-error" role="alert">{error ?? snapshot.error ?? snapshot.runtime.error}</p>}
    {saved && !error && <p className="dshmini-muted" role="status">Saved.</p>}
    <div className="dshmini-actions"><button className="dshmini-button" disabled={busy || !snapshot.state.enabled} onClick={() => void run(() => client.command('show'))}>Show window</button><button className="dshmini-button" disabled={busy || !snapshot.state.enabled} onClick={() => void run(() => client.command('restart'))}>Restart companion</button><button className="dshmini-button" disabled={busy || snapshot.runtime.status === 'stopped'} onClick={() => void run(() => client.command('quit'))}>Quit companion</button></div>
    <div className="dshmini-help"><p><kbd>⌘N</kbd> New chat · <kbd>⌘W</kbd> Hide window</p><p>Drag the header to move. Expanded mode is resizable and remembers its size. Hiding never cancels a running session.</p><p>The Electron runtime is required. If missing, run <code>npm run setup:electron</code> in this plugin’s directory, then restart the companion.</p></div>
  </div>
}
export function SessionPicker({ controller, onPick, close }: { controller: MiniSessions; onPick: (id: SessionId) => void; close: () => void }) {
  const catalog = useSyncExternalStore(controller.sessions.list.subscribe, controller.sessions.list.getSnapshot)
  const workspaces = useSyncExternalStore(controller.workspaces.list.subscribe, controller.workspaces.list.getSnapshot)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ sessionId: SessionId; snippet: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { field.current?.focus() }, [])
  useEffect(() => {
    const abort = new AbortController()
    setHits([]); setError(null); setHasMore(false)
    if (!query.trim()) { setSearching(false); return () => abort.abort() }
    setSearching(true)
    const timer = setTimeout(() => { void controller.sessions.search(query.trim(), abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (!result.ok) throw new Error(result.error.message)
      setHits(result.value.items); setHasMore(result.value.hasMore)
    }).catch(e => { if (!abort.signal.aborted) setError(message(e)) }).finally(() => { if (!abort.signal.aborted) setSearching(false) }) }, 250)
    return () => { clearTimeout(timer); abort.abort() }
  }, [controller, query])
  const archived = new Set(workspaces.archivedSessionIds)
  const needle = query.trim().toLocaleLowerCase()
  const rows = catalog.ids.map(id => catalog.byId[id]).filter(row => row && !archived.has(row.id) && (!row.blank || row.id === controller.getSnapshot().reference?.sessionId)).sort((a, b) => b.updatedAt - a.updatedAt)
  const filtered = rows.filter(row => !needle || `${row.displayTitle} ${row.cwd ?? ''}`.toLocaleLowerCase().includes(needle) || hits.some(hit => hit.sessionId === row.id))
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown','ArrowUp'].includes(event.key)) return
    const targets = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[data-mini-session]') ?? [])
    if (!targets.length) return
    event.preventDefault()
    const index = targets.indexOf(document.activeElement as HTMLButtonElement)
    targets[(index + (event.key === 'ArrowDown' ? 1 : -1) + targets.length) % targets.length]?.focus()
  }
  return <div className="dshmini-picker" ref={panel} onKeyDown={navigate}>
    <div className="dshmini-picker-top"><h2>Sessions</h2><IconButton label="Close sessions" icon="close" onClick={close} /></div>
    <label className="dshmini-search"><Icon name="search" /><input ref={field} aria-label="Search sessions and messages" placeholder="Search sessions and messages" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="dshmini-results" aria-label="Existing sessions">
      {catalog.phase !== 'ready' && <p className="dshmini-muted" role="status">Loading sessions…</p>}
      {filtered.map(row => { const workspace = workspaces.items.find(w => w.sessionIds.includes(row.id)); const hit = hits.find(h => h.sessionId === row.id); return <button type="button" className="dshmini-session" aria-label={`${row.displayTitle} · ${workspace?.title || row.cwd || 'Ungrouped'}${row.running ? ' · Running' : ''}`} data-mini-session key={row.id} onClick={() => onPick(row.id)}><span className="dshmini-session-title">{row.running && <span className="dshmini-dot is-ready" aria-label="Running" />}{row.displayTitle}</span><span className="dshmini-session-meta">{workspace?.title || row.cwd || 'Ungrouped'} · {new Date(row.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>{hit && <span className="dshmini-snippet">{hit.snippet}</span>}</button> })}
      {searching && <p className="dshmini-muted" role="status">Searching messages…</p>}
      {!searching && catalog.phase === 'ready' && !filtered.length && <p className="dshmini-muted">{query ? 'No sessions match. Try another phrase.' : 'No conversations yet. Start a new chat.'}</p>}
      {error && <p className="dshmini-error" role="alert">Message search failed: {error} You can still search session titles.</p>}
      {hasMore && <p className="dshmini-muted">More message matches exist. Narrow your search.</p>}
    </div>
  </div>
}
export function MiniRoot({ controller, client, native, SessionProvider, renderSlot }: { controller: MiniSessions; client: HostClient; native: NativeBridge; SessionProvider: (p: { session: unknown; children: ReactNode }) => ReactNode; renderSlot: (name: string, owner: object) => ReactNode }) {
  const selection = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const catalog = useSyncExternalStore(controller.sessions.list.subscribe, controller.sessions.list.getSnapshot)
  const workspaceState = useSyncExternalStore(controller.workspaces.list.subscribe, controller.workspaces.list.getSnapshot)
  const host = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState<'sessions' | 'settings' | 'workspaces' | null>(null)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const historyButton = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLElement>(null)
  const expandedRef = useRef(false)
  const pickerExpanded = useRef(false)
  const expand = (value: boolean) => { pickerExpanded.current = false; void native.setExpanded(value).catch(e => setBridgeError(message(e))) }
  const focusComposer = () => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-composer-input]')?.focus())
  const newChat = async (workspace?: WorkspaceId | null) => { setPanel(null); if (await controller.newChat(workspace)) { expand(false); focusComposer() } }
  const openPanel = (value: 'sessions' | 'settings' | 'workspaces') => { expand(true); setPanel(value) }
  const closePanel = () => { setPanel(null); requestAnimationFrame(() => historyButton.current?.focus()) }
  // React 18 has no `inert` prop, so the attribute is toggled directly.
  useEffect(() => { content.current?.toggleAttribute('inert', panel !== null) }, [panel])
  useEffect(() => {
    let active = true
    void native.getState().then(value => { if (active) { expandedRef.current = value.expanded; setExpanded(value.expanded) } }).catch(e => setBridgeError(message(e)))
    const stateOff = native.onState(value => { expandedRef.current = value.expanded; setExpanded(value.expanded); const current = controller.getSnapshot(); if (value.visible && !current.reference && current.error && !current.busy) void controller.initialize().then(focusComposer); else if (value.visible && !root.current?.querySelector('.dshmini-panel')) focusComposer() })
    const commandOff = native.onCommand(command => { if (command === 'new-chat') void controller.initialize().then(() => newChat()); else openPanel('settings') })
    void controller.initialize().then(() => { if (active) focusComposer() })
    return () => { active = false; stateOff(); commandOff() }
  }, [controller, native])
  useEffect(() => {
    if (!expanded || !pickerExpanded.current) return
    let closed = false
    const observe = () => {
      if (closed || !pickerExpanded.current) return
      if (!root.current?.querySelector('.codexModelSelectMenu')) {
        pickerExpanded.current = false
        void native.setExpanded(false).catch(e => setBridgeError(message(e)))
      }
    }
    const observer = new MutationObserver(observe)
    if (root.current) observer.observe(root.current, { childList: true, subtree: true })
    return () => { closed = true; observer.disconnect() }
  }, [expanded, native])
  const current = selection.reference ? catalog.byId[selection.reference.sessionId] : undefined
  const workspace = workspaceState.items.find(w => w.workspaceId === selection.workspaceId)
  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (expandedRef.current || !((event.target as HTMLElement).closest('.codexModelSelectTrigger'))) return
    pickerExpanded.current = true
    void native.setExpanded(true).catch(e => { pickerExpanded.current = false; setBridgeError(message(e)) })
  }
  // Title bar (and the compact drag strip): drag moves the window, double-click
  // toggles expanded mode. Elsewhere double-click stays text selection.
  const titleBar = (target: EventTarget) => { const el = target as HTMLElement; return Boolean(el.closest('.dshmini-header,.dshmini-drag-strip')) && !el.closest('button,input,select,textarea,[contenteditable="true"],a') }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !native.drag || !titleBar(event.target)) return
    const el = event.currentTarget
    const end = () => { el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); el.removeEventListener('lostpointercapture', end); void native.drag?.('end').catch(() => {}) }
    try { el.setPointerCapture(event.pointerId) } catch {}
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end)
    void native.drag('start').catch(() => {})
  }
  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = event.target as HTMLElement
    if (titleBar(el)) { expand(!expanded); return }
    // Compact mode has no selectable text; its padding keeps the old shortcut.
    if (!expanded && !el.closest('button,input,select,textarea,[contenteditable="true"],a,.codexModelSelectMenu')) expand(true)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      if (event.defaultPrevented || document.querySelector('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return
      event.preventDefault(); event.stopPropagation()
      if (panel) closePanel(); else void native.hide().catch(e => setBridgeError(message(e)))
    }
    if (panel && event.key === 'Tab') {
      const targets = Array.from(root.current?.querySelectorAll<HTMLElement>('.dshmini-panel button:not(:disabled),.dshmini-panel input:not(:disabled),.dshmini-panel select:not(:disabled)') ?? []).filter(el => el.offsetParent !== null)
      const first = targets[0], last = targets.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }
  return <div ref={root} className="dshmini-root" data-dsh-mini data-expanded={expanded} onClickCapture={onClickCapture} onKeyDown={onKeyDown} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
    <div className="dshmini-drag-strip" aria-hidden="true" />
    <header className="dshmini-header">
      <IconButton label="Hide window · ⌘W" icon="close" onClick={() => void native.hide().catch(e => setBridgeError(message(e)))} />
      <button type="button" className="dshmini-title" aria-label="Choose workspace for a new chat" title={workspace?.path ?? current?.cwd ?? 'Uncategorized'} onClick={() => openPanel('workspaces')}><strong>{expanded && current && !current.blank ? current.displayTitle : 'DSH'}</strong><span>{workspace?.title || (current ? 'Uncategorized' : 'New chat')}</span></button>
      <button ref={historyButton} type="button" className="dshmini-icon" title="Existing sessions" aria-label="Existing sessions" onClick={() => openPanel('sessions')}><Icon name="history" /></button>
      <IconButton label="New chat · ⌘N" icon="plus" disabled={selection.busy || !selection.initialized} onClick={() => void newChat()} />
      <IconButton label="Mini window settings" icon="settings" onClick={() => openPanel('settings')} />
      <IconButton label={expanded ? 'Collapse window' : 'Expand window'} icon={expanded ? 'collapse' : 'expand'} onClick={() => { setPanel(null); expand(!expanded) }} />
    </header>
    {(bridgeError || selection.error || host.error) && <div className="dshmini-notice" role="alert"><span>{bridgeError || selection.error || host.error}</span><button type="button" aria-label="Dismiss error" onClick={() => { setBridgeError(null); controller.clearError() }}><Icon name="close" /></button></div>}
    <main ref={content} className="dshmini-content" aria-label="DSH mini chat" aria-busy={selection.busy}>
      {selection.reference ? <SessionProvider session={selection.reference}>{renderSlot('mini.conversation', {})}</SessionProvider> : <div className="dshmini-setup"><p>{selection.initialized ? 'Start a chat in a workspace or uncategorized.' : 'Connecting to DSH…'}</p>{selection.initialized && <label>Location<select aria-label="New chat location" value="" disabled={selection.busy} onChange={e => void newChat(e.target.value === 'uncategorized' ? null : e.target.value as WorkspaceId)}><option value="">Choose a location</option><option value="uncategorized">Uncategorized</option>{workspaceState.items.map(w => <option value={w.workspaceId} key={w.workspaceId}>{w.title || w.path}</option>)}</select></label>}</div>}
    </main>
    {panel && <section className="dshmini-panel" role="dialog" aria-modal="true" aria-label={panel === 'sessions' ? 'Choose an existing session' : panel === 'workspaces' ? 'Choose a workspace' : 'Mini window settings'}>{panel === 'sessions' ? <SessionPicker controller={controller} close={closePanel} onPick={id => { void controller.open(id).then(ok => { if (ok) { setPanel(null); expand(true); focusComposer() } }) }} /> : panel === 'settings' ? <Settings client={client} close={closePanel} /> : <div className="dshmini-picker"><div className="dshmini-picker-top"><h2>New chat in…</h2><IconButton label="Close workspace picker" icon="close" onClick={closePanel} /></div><p className="dshmini-muted">Choose a workspace, or leave the chat uncategorized.</p><div className="dshmini-results"><button type="button" className="dshmini-session" disabled={selection.busy} onClick={() => void newChat(null)}><span className="dshmini-session-title">Uncategorized</span><span className="dshmini-session-meta">No workspace · uses the DSH server’s working directory</span></button>{workspaceState.items.map(w => <button type="button" key={w.workspaceId} className="dshmini-session" disabled={selection.busy} onClick={() => void newChat(w.workspaceId)}><span className="dshmini-session-title">{w.title || w.path}</span><span className="dshmini-session-meta">{w.path}</span></button>)}</div></div>}</section>}
  </div>
}
