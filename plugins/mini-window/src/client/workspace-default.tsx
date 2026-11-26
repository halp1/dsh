import { useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostClient, MiniState } from './host-client.ts'

type Choice = { key: string; value: MiniState['defaultWorkspace']; title: string; detail?: string }
const LAST: Choice = { key: 'last', value: null, title: 'Last used workspace' }
const NONE: Choice = { key: 'none', value: { workspaceId: null }, title: 'Uncategorized' }
const keyOf = (value: MiniState['defaultWorkspace']) => value === null ? LAST.key : value.workspaceId === null ? NONE.key : `ws:${value.workspaceId}`

/** Case-insensitive match on every space-separated term, against title and path. */
export function filterChoices<T extends { title: string; detail?: string }>(choices: readonly T[], query: string): T[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return choices.filter(choice => { const text = `${choice.title} ${choice.detail ?? ''}`.toLocaleLowerCase(); return terms.every(term => text.includes(term)) })
}

export function WorkspaceDefault({ client, workspaces }: { client: HostClient; workspaces: IWorkspaces }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const list = useSyncExternalStore(workspaces.list.subscribe, workspaces.list.getSnapshot)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const listbox = useRef<HTMLUListElement>(null)
  const id = useId()
  const choices = useMemo<Choice[]>(() => [LAST, NONE, ...list.items.map(w => ({ key: `ws:${w.workspaceId}`, value: { workspaceId: w.workspaceId }, title: w.title || w.path, detail: w.path }))], [list.items])
  const stored = snapshot.state.defaultWorkspace
  const current = choices.find(choice => choice.key === keyOf(stored))
  const missing = stored?.workspaceId != null && !current && list.phase === 'ready'
  const shown = filterChoices(choices, query)
  const index = Math.min(active, shown.length - 1)
  const pick = async (choice: Choice) => {
    setOpen(false); setQuery(''); setError(null)
    if (choice.key === keyOf(stored)) return
    setBusy(true)
    try { await client.patch({ defaultWorkspace: choice.value }) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const move = (to: number) => {
    setActive(to); setOpen(true)
    requestAnimationFrame(() => listbox.current?.querySelector(`#${CSS.escape(`${id}-${to}`)}`)?.scrollIntoView({ block: 'nearest' }))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!shown.length) return
      move(!open ? 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length)
    } else if (event.key === 'Enter' && open && shown[index]) { event.preventDefault(); void pick(shown[index]) }
    else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery('') }
  }
  const label = missing ? 'Missing workspace' : current?.title ?? 'Last used workspace'
  return <section className="dshmini-workspace-default" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Default workspace</h3>
    <div className="dshmini-combo" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setQuery('') } }}>
      <input ref={input} role="combobox" aria-label="Default workspace for new mini chats" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={open && shown[index] ? `${id}-${index}` : undefined}
        spellCheck={false} autoComplete="off" disabled={busy || snapshot.loading} placeholder={label} value={open ? query : label} title={current?.detail}
        onFocus={() => { setOpen(true); setActive(Math.max(0, shown.findIndex(choice => choice.key === current?.key))) }}
        onClick={() => setOpen(true)}
        onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true) }}
        onKeyDown={onKeyDown} />
      {open && <ul ref={listbox} id={`${id}-list`} role="listbox" className="dshmini-combo-list" aria-label="Workspaces">
        {shown.map((choice, at) => <li key={choice.key} id={`${id}-${at}`} role="option" aria-selected={choice.key === current?.key} data-active={at === index ? '' : undefined}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => { if (at !== index) setActive(at) }} onClick={() => void pick(choice)}>
          <span>{choice.title}</span>{choice.detail && choice.detail !== choice.title && <small>{choice.detail}</small>}
        </li>)}
        {!shown.length && <li className="dshmini-combo-empty" role="presentation">No workspaces match</li>}
      </ul>}
    </div>
    {missing && <p className="dshmini-error" role="alert">The saved workspace no longer exists. New chats use the last used workspace until you pick another.</p>}
    {error && <p className="dshmini-error" role="alert">{error}</p>}
  </section>
}
