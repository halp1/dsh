/**
 * The switcher dialog.
 *
 * The overlay entry renders nothing while closed. The dialog body mounts only
 * while open, so list subscriptions and content search cost nothing the rest
 * of the time, and every open starts from an empty query.
 * @module
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { createContentSearch } from './content-search.ts'
import { mainSessionId, type SessionList, type Source, type WorkspaceList } from './host.ts'
import type { SearchFn } from './content-search.ts'
import { ago, buildSections, type Item } from './items.ts'
import type { Range } from './match.ts'
import type { SwitcherStore } from './state.ts'

/** `shortcutModal` id; the keyboard handler toggles on it. */
export const MODAL_ID = 'quickswitcher'

/** What the overlay entry receives through the slot's `inject`. */
export interface SwitcherDeps {
  readonly store: SwitcherStore
  readonly sessions: Source<SessionList>
  readonly workspaces: Source<WorkspaceList>
  readonly recent: () => readonly string[]
  readonly search: SearchFn
  readonly openSession: (sessionId: string) => void
  readonly openWorkspace: (workspaceId: string) => void
}

/** Overlay entry. */
export function QuickSwitcher(props: SwitcherDeps): ReactNode {
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  if (!state.open) return null
  return <Dialog key={state.generation} {...props} />
}

/** Render text with `<mark>` over the given ranges. */
function Highlight({ text, ranges }: { text: string, ranges: readonly Range[] }): ReactNode {
  if (ranges.length === 0) return text
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>)
    at = end
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}

function Dialog({ store, sessions, workspaces, recent, search, openSession, openWorkspace }: SwitcherDeps): ReactNode {
  const baseId = useId()
  const listId = `${baseId}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement)
  const activated = useRef(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  const sessionList = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot)
  const workspaceList = useSyncExternalStore(workspaces.subscribe, workspaces.getSnapshot)
  // The recent list and the open session are read once per open: the
  // switcher describes where you were when you pressed the key.
  const [frozen] = useState(() => ({ recent: recent(), currentId: mainSessionId(sessions.getSnapshot()) }))

  const [content] = useState(() => createContentSearch({
    search,
    onError: error => console.warn('[quickswitcher] content search failed:', error),
  }))
  const contentState = useSyncExternalStore(content.subscribe, content.getSnapshot)
  useEffect(() => () => content.dispose(), [content])
  useEffect(() => { content.update(query) }, [content, query])

  const sections = useMemo(() => buildSections({
    query,
    sessions: sessionList,
    workspaces: workspaceList,
    recent: frozen.recent,
    currentId: frozen.currentId,
    contentHits: contentState.query === query.trim() ? contentState.hits : [],
  }), [query, sessionList, workspaceList, frozen, contentState])

  const flat = useMemo(() => sections.flatMap(section => section.items), [sections])
  const active = Math.min(selected, Math.max(0, flat.length - 1))
  const activeItem: Item | undefined = flat[active]
  const optionId = (item: Item): string => `${baseId}-${item.key}`

  // Typing resets the highlight to the best match. Content hits arriving
  // later append below and never move it.
  useEffect(() => { setSelected(0) }, [query])

  useLayoutEffect(() => {
    if (activeItem === undefined) return
    document.getElementById(optionId(activeItem))?.scrollIntoView({ block: 'nearest' })
  })

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    return () => {
      if (activated.current) return
      const target = returnFocus.current
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
    }
  }, [])

  const close = (): void => { store.close() }

  const activate = (item: Item | undefined): void => {
    if (item === undefined) return
    activated.current = true
    store.close()
    if (item.kind === 'workspace') openWorkspace(item.workspaceId)
    else openSession(item.sessionId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    const count = flat.length
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        if (count === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setSelected((active + step + count) % count)
        return
      }
      case 'n':
      case 'p': {
        // Emacs-style Ctrl+N / Ctrl+P, which macOS text fields already teach.
        if (!event.ctrlKey || event.metaKey || event.altKey || count === 0) return
        event.preventDefault()
        setSelected((active + (event.key === 'n' ? 1 : -1) + count) % count)
        return
      }
      case 'Home':
      case 'End':
        if (!event.ctrlKey && !event.metaKey) return
        event.preventDefault()
        setSelected(event.key === 'Home' ? 0 : Math.max(0, count - 1))
        return
      case 'Enter':
        event.preventDefault()
        activate(activeItem)
        return
      default:
    }
  }

  const now = Date.now()
  const searching = contentState.status === 'pending' && contentState.query === query.trim()

  return (
    <Modal
      open
      headless
      title="Quick switcher"
      onClose={close}
      className="dshqs"
      backdropBlur={false}
      shortcutModal={MODAL_ID}
    >
      <input
        ref={inputRef}
        className="dshqs-input"
        type="text"
        role="combobox"
        aria-label="Search sessions and workspaces"
        aria-expanded={flat.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeItem === undefined ? undefined : optionId(activeItem)}
        aria-busy={searching || undefined}
        placeholder="Jump to…"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={event => { setQuery(event.target.value) }}
        onKeyDown={onKeyDown}
      />
      <div id={listId} className="dshqs-list" role="listbox" aria-label="Results">
        {sections.map(section => {
          const headingId = `${baseId}-${section.key}`
          return (
            <div key={section.key} className="dshqs-group" role="group" aria-labelledby={headingId}>
              <div id={headingId} className="dshqs-heading" role="presentation">{section.label}</div>
              {section.items.map(item => {
                const index = flat.indexOf(item)
                return (
                  <div
                    key={item.key}
                    id={optionId(item)}
                    className="dshqs-option"
                    role="option"
                    aria-selected={index === active}
                    onPointerMove={() => { if (index !== active) setSelected(index) }}
                    onPointerDown={event => { event.preventDefault() }}
                    onClick={() => { activate(item) }}
                  >
                    <Row item={item} now={now} />
                  </div>
                )
              })}
            </div>
          )
        })}
        {flat.length === 0 && !searching && query.trim() !== '' && (
          <div className="dshqs-empty" role="presentation">No matches</div>
        )}
      </div>
    </Modal>
  )
}

function Row({ item, now }: { item: Item, now: number }): ReactNode {
  if (item.kind === 'workspace') {
    return (
      <>
        <span className="dshqs-main">
          <span className="dshqs-title"><Highlight text={item.title} ranges={item.titleRanges} /></span>
        </span>
        <span className="dshqs-meta">
          <span className="dshqs-context"><Highlight text={item.context} ranges={item.contextRanges} /></span>
        </span>
      </>
    )
  }
  const running = item.running && (
    <span className="dshqs-dot" role="img" aria-label="Running" />
  )
  if (item.kind === 'message') {
    return (
      <>
        <span className="dshqs-main">
          <span className="dshqs-title">{item.title}</span>
          <span className="dshqs-snippet">{item.snippet}</span>
        </span>
        <span className="dshqs-meta">
          {running}
          <span className="dshqs-context">{item.context}</span>
          <span className="dshqs-age">{ago(item.updatedAt, now)}</span>
        </span>
      </>
    )
  }
  return (
    <>
      <span className="dshqs-main">
        <span className="dshqs-title"><Highlight text={item.title} ranges={item.titleRanges} /></span>
      </span>
      <span className="dshqs-meta">
        {running}
        <span className="dshqs-context"><Highlight text={item.context} ranges={item.contextRanges} /></span>
        <span className="dshqs-age">{ago(item.updatedAt, now)}</span>
      </span>
    </>
  )
}
