/**
 * Settings → Background.
 *
 * Every control edits the shared library through the state client. Sliders
 * preview locally while dragging and persist after 300 ms of stillness, so a
 * drag is one save rather than dozens.
 * @module
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import {
  Button,
  IconCheckOutlineMedium,
  IconCloseOutlineMedium,
  IconEditOutlineMedium,
  IconFolderCloseMedium,
  IconRefreshOutlineMedium,
  IconTrashOutlineMedium,
  IconWarningOutlineMedium,
  Input,
  SegmentedControl,
  Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  BLUR_MAX,
  INTERVAL_MAX,
  INTERVAL_MIN,
  OPACITY_MAX,
  OPACITY_MIN,
  entryLabel,
  type Appearance,
  type Entry,
  type Fit,
  type Op,
  type Position,
  type RotationOrder,
} from '../shared/state.ts'
import { loadImageSource } from './image-source.ts'
import { fileUrl } from './pool.ts'
import type { ClientSnapshot, StateClient } from './state-client.ts'

/** Props: the settings shell's owner share plus this plugin's injection. */
export interface BackgroundTabProps {
  close: () => void
  client: StateClient
}

const FIT_OPTIONS = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'tile', label: 'Tile' },
] as const satisfies readonly { value: Fit; label: string }[]

const POSITION_OPTIONS = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
] as const satisfies readonly { value: Position; label: string }[]

const ORDER_OPTIONS = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'shuffle', label: 'Shuffle' },
] as const satisfies readonly { value: RotationOrder; label: string }[]

function useSnapshot(client: StateClient): ClientSnapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot)
}

/**
 * Preview an op immediately and send the latest one per key after `delay` ms.
 * Pending sends flush on unmount so closing Settings mid-drag still saves.
 */
function useDebouncedSend(client: StateClient, delay = 300): (key: string, op: Op) => void {
  const pending = useRef(new Map<string, { op: Op; timer: ReturnType<typeof setTimeout> }>())
  useEffect(() => () => {
    for (const { op, timer } of pending.current.values()) {
      clearTimeout(timer)
      void client.send(op)
    }
    pending.current.clear()
  }, [client])
  return useCallback((key: string, op: Op) => {
    client.preview(op)
    const existing = pending.current.get(key)
    if (existing !== undefined) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      pending.current.delete(key)
      void client.send(op)
    }, delay)
    pending.current.set(key, { op, timer })
  }, [client, delay])
}

function thumbnailUrl(entry: Entry, snapshot: ClientSnapshot): string | undefined {
  if (entry.kind === 'url') return entry.source
  if (entry.kind === 'file') return snapshot.info.files[entry.id]?.ok === false ? undefined : fileUrl(entry.id, 0)
  const folder = snapshot.info.folders[entry.id]
  return folder !== undefined && 'count' in folder && folder.count > 0 ? fileUrl(entry.id, 0) : undefined
}

function AddRow({ client }: { client: StateClient }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const source = value.trim()
    if (source === '' || busy) return
    setBusy(true)
    setError(undefined)
    const before = new Set(client.getSnapshot().state.entries.map((e) => e.id))
    const result = await client.send({ type: 'add', source })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setValue('')
    // Adding a background is almost always meant to show it.
    const { state } = client.getSnapshot()
    const added = state.entries.find((e) => !before.has(e.id))
    if (added !== undefined && !state.rotation.enabled) void client.send({ type: 'set-active', id: added.id })
  }
  return (
    <form className="dshbg-section" onSubmit={submit}>
      <div className="dshbg-add">
        <Input
          value={value}
          placeholder="Local path (~/Pictures/wall.jpg, a folder) or https:// URL"
          aria-label="Background path or URL"
          spellCheck={false}
          onChange={(e) => { setValue(e.target.value); setError(undefined) }}
        />
        <Button type="submit" variant="primary" size="sm" disabled={busy || value.trim() === ''}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error === undefined
        ? <p className="dshbg-hint">Paths are on the machine running dsh. A folder shows its images at random, or all of them in rotation.</p>
        : <p className="dshbg-error" role="alert">{error}</p>}
    </form>
  )
}

function Tile(props: {
  entry: Entry
  snapshot: ClientSnapshot
  active: boolean
  rotating: boolean
  editing: boolean
  onSelect(): void
  onToggleRotation(): void
  onEdit(): void
  onRemove(): void
}) {
  const { entry, snapshot } = props
  const [broken, setBroken] = useState(false)
  const [src, setSrc] = useState<string | undefined>()
  const [removing, setRemoving] = useState(false)
  const thumbnail = useRef<HTMLDivElement>(null)
  const candidate = thumbnailUrl(entry, snapshot)
  useEffect(() => {
    let active = true
    let started = false
    let dispose: (() => void) | undefined
    let observer: IntersectionObserver | undefined
    setBroken(false)
    setSrc(undefined)
    const load = () => {
      if (!active || started || candidate === undefined) return
      started = true
      void loadImageSource(candidate).then((source) => {
        if (!active) { source.dispose(); return }
        dispose = () => source.dispose()
        setSrc(source.url)
      }).catch(() => { if (active) setBroken(true) })
    }
    if (candidate !== undefined && thumbnail.current !== null && typeof IntersectionObserver !== 'undefined') {
      // Native img lazy-loading happens too late for a fetch-backed blob.
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer?.disconnect()
        load()
      })
      observer.observe(thumbnail.current)
    } else {
      load()
    }
    return () => { active = false; observer?.disconnect(); dispose?.() }
  }, [candidate])
  const folder = entry.kind === 'folder' ? snapshot.info.folders[entry.id] : undefined
  const count = folder !== undefined && 'count' in folder ? folder.count : undefined
  const failed = broken || candidate === undefined
  const label = entryLabel(entry)
  return (
    <div
      className="dshbg-tile"
      data-active={props.active ? '' : undefined}
      data-excluded={props.rotating && !entry.inRotation ? '' : undefined}
    >
      <button type="button" className="dshbg-select" aria-pressed={props.active} title={entry.source} onClick={props.onSelect}>
        <div className="dshbg-thumb" ref={thumbnail}>
          {failed
            ? <IconWarningOutlineMedium className="dshbg-warn" size={20} />
            : src !== undefined && <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />}
          {props.active && <span className="dshbg-check"><IconCheckOutlineMedium size={14} /></span>}
          {entry.kind === 'folder' && (
            <span className="dshbg-badge"><IconFolderCloseMedium size={12} />{count ?? '!'}</span>
          )}
        </div>
        <span className="dshbg-label">{label}</span>
      </button>
      <div className="dshbg-actions">
        {props.rotating && (
          <button
            type="button"
            className="dshbg-action"
            data-on={entry.inRotation ? '' : undefined}
            title={entry.inRotation ? 'In rotation (click to exclude)' : 'Excluded from rotation (click to include)'}
            aria-label="Toggle rotation"
            onClick={props.onToggleRotation}
          >
            <IconRefreshOutlineMedium size={14} />
          </button>
        )}
        <button type="button" className="dshbg-action" data-on={props.editing ? '' : undefined} title="Edit" aria-label="Edit" onClick={props.onEdit}>
          <IconEditOutlineMedium size={14} />
        </button>
        <button type="button" className="dshbg-action" title="Remove" aria-label={`Remove ${label}`} aria-expanded={removing} onClick={() => setRemoving(!removing)}>
          <IconTrashOutlineMedium size={14} />
        </button>
      </div>
      {removing && (
        <div className="dshbg-remove">
          <p className="dshbg-hint">Remove from all devices?</p>
          <div className="dshbg-inline">
            <Button type="button" size="sm" aria-label={`Confirm removal of ${label}`} onClick={props.onRemove}>Remove</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRemoving(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function NoneTile({ active, onSelect }: { active: boolean; onSelect(): void }) {
  return (
    <button type="button" className="dshbg-tile" aria-pressed={active} data-active={active ? '' : undefined} onClick={onSelect}>
      <div className="dshbg-thumb">
        <IconCloseOutlineMedium size={20} />
        {active && <span className="dshbg-check"><IconCheckOutlineMedium size={14} /></span>}
      </div>
      <span className="dshbg-label">None</span>
    </button>
  )
}

/** Opacity/blur/fit/position controls, shared by the global and per-image editors. */
function AppearanceControls(props: {
  idPrefix: string
  value: Appearance
  onChange(key: keyof Appearance, patch: Partial<Appearance>): void
  overridden?: Partial<Record<keyof Appearance, boolean>>
  onReset?: (key: keyof Appearance) => void
}) {
  const { value, idPrefix } = props
  const reset = (key: keyof Appearance) => props.onReset === undefined ? null : (
    <button type="button" className="dshbg-reset" disabled={props.overridden?.[key] !== true} onClick={() => props.onReset?.(key)}>
      Use global
    </button>
  )
  return (
    <>
      <div className="dshbg-row">
        <label htmlFor={`${idPrefix}-opacity`}>Opacity</label>
        <input
          id={`${idPrefix}-opacity`}
          className="dshbg-range"
          type="range"
          min={OPACITY_MIN}
          max={OPACITY_MAX}
          step={0.01}
          value={value.opacity}
          onChange={(e) => props.onChange('opacity', { opacity: Number(e.target.value) })}
        />
        <span className="dshbg-inline"><span className="dshbg-value">{value.opacity.toFixed(2)}</span>{reset('opacity')}</span>
      </div>
      <div className="dshbg-row">
        <label htmlFor={`${idPrefix}-blur`}>Blur</label>
        <input
          id={`${idPrefix}-blur`}
          className="dshbg-range"
          type="range"
          min={0}
          max={BLUR_MAX}
          step={1}
          value={value.blur}
          onChange={(e) => props.onChange('blur', { blur: Number(e.target.value) })}
        />
        <span className="dshbg-inline"><span className="dshbg-value">{value.blur}px</span>{reset('blur')}</span>
      </div>
      <div className="dshbg-row">
        <span>Fit</span>
        <SegmentedControl id={`${idPrefix}-fit`} label="Fit" value={value.fit} options={FIT_OPTIONS} onChange={(fit) => props.onChange('fit', { fit })} />
        {reset('fit') ?? <span />}
      </div>
      <div className="dshbg-row">
        <span>Position</span>
        <SegmentedControl id={`${idPrefix}-position`} label="Position" value={value.position} options={POSITION_OPTIONS} onChange={(position) => props.onChange('position', { position })} />
        {reset('position') ?? <span />}
      </div>
    </>
  )
}

function withoutLabel(entry: Entry): Entry {
  const { label: _label, ...rest } = entry
  return rest
}

function EntryEditor({ entry, global, client, onClose }: { entry: Entry; global: Appearance; client: StateClient; onClose(): void }) {
  const debounced = useDebouncedSend(client)
  const [label, setLabel] = useState(entry.label ?? '')
  useEffect(() => { setLabel(entry.label ?? '') }, [entry.id, entry.label])
  const overrides = entry.overrides ?? {}
  const effective = { ...global, ...overrides }
  const overridden = Object.fromEntries(Object.keys(overrides).map((k) => [k, true])) as Partial<Record<keyof Appearance, boolean>>
  const setOverride = (key: keyof Appearance, patch: Partial<Appearance>) =>
    debounced(`entry:${entry.id}:${key}`, { type: 'update-entry', id: entry.id, patch: { overrides: { ...overrides, ...patch } } })
  const resetOverride = (key: keyof Appearance) => {
    const next = { ...overrides }
    delete next[key]
    void client.send({ type: 'update-entry', id: entry.id, patch: { overrides: Object.keys(next).length === 0 ? null : next } })
  }
  const commitLabel = () => {
    if (label.trim() !== (entry.label ?? '')) void client.send({ type: 'update-entry', id: entry.id, patch: { label } })
  }
  return (
    <div className="dshbg-editor">
      <div className="dshbg-editor-head">
        <h4 className="dshbg-heading">This image</h4>
        <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
      </div>
      <div className="dshbg-row">
        <label htmlFor={`dshbg-${entry.id}-label`}>Name</label>
        <Input
          id={`dshbg-${entry.id}-label`}
          value={label}
          placeholder={entryLabel(withoutLabel(entry))}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => { if (e.key === 'Enter') commitLabel() }}
        />
        <span />
      </div>
      <AppearanceControls
        idPrefix={`dshbg-${entry.id}`}
        value={effective}
        onChange={setOverride}
        overridden={overridden}
        onReset={resetOverride}
      />
      <p className="dshbg-hint">{entry.source}</p>
    </div>
  )
}

/**
 * The tab body.
 * @param props - `{ close, client }`.
 * @returns the Background settings page.
 */
export function BackgroundTab({ client }: BackgroundTabProps) {
  const snapshot = useSnapshot(client)
  const debounced = useDebouncedSend(client)
  const [editing, setEditing] = useState<string | null>(null)
  const { state } = snapshot
  const rotating = state.rotation.enabled
  const editingEntry = state.entries.find((e) => e.id === editing)
  const [interval, setIntervalText] = useState(String(state.rotation.intervalMin))
  useEffect(() => { setIntervalText(String(state.rotation.intervalMin)) }, [state.rotation.intervalMin])

  useEffect(() => { void client.refresh() }, [client])

  const commitInterval = () => {
    const n = Math.round(Number(interval))
    if (!Number.isFinite(n)) { setIntervalText(String(state.rotation.intervalMin)); return }
    const clamped = Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, n))
    setIntervalText(String(clamped))
    if (clamped !== state.rotation.intervalMin) void client.send({ type: 'set-rotation', patch: { intervalMin: clamped } })
  }

  return (
    <div className="dshbg">
      <section className="dshbg-section">
        <h3 className="dshbg-heading">Backgrounds</h3>
        <AddRow client={client} />
        {snapshot.status === 'error' && <p className="dshbg-error">Could not reach dsh: {snapshot.error}</p>}
        <div className="dshbg-grid">
          <NoneTile active={state.activeId === null} onSelect={() => { void client.send({ type: 'set-active', id: null }) }} />
          {state.entries.map((entry) => (
            <Tile
              key={entry.id}
              entry={entry}
              snapshot={snapshot}
              active={state.activeId === entry.id}
              rotating={rotating}
              editing={editing === entry.id}
              onSelect={() => { void client.send({ type: 'set-active', id: entry.id }) }}
              onToggleRotation={() => { void client.send({ type: 'update-entry', id: entry.id, patch: { inRotation: !entry.inRotation } }) }}
              onEdit={() => setEditing(editing === entry.id ? null : entry.id)}
              onRemove={() => {
                if (editing === entry.id) setEditing(null)
                void client.send({ type: 'remove', id: entry.id })
              }}
            />
          ))}
        </div>
        {rotating && <p className="dshbg-hint">Rotation is on: images marked with ⟳ take turns. Click a tile to choose what shows when rotation is off.</p>}
        {editingEntry !== undefined && (
          <EntryEditor entry={editingEntry} global={state.appearance} client={client} onClose={() => setEditing(null)} />
        )}
      </section>

      <section className="dshbg-section">
        <h3 className="dshbg-heading">Appearance</h3>
        <AppearanceControls
          idPrefix="dshbg-global"
          value={state.appearance}
          onChange={(key, patch) => debounced(`global:${key}`, { type: 'set-appearance', patch })}
        />
      </section>

      <section className="dshbg-section">
        <h3 className="dshbg-heading">Rotation</h3>
        <div className="dshbg-inline">
          <Switch
            checked={rotating}
            label="Rotate backgrounds"
            onChange={(enabled) => { void client.send({ type: 'set-rotation', patch: { enabled } }) }}
          />
          <span className="dshbg-inline">
            every
            <Input
              className="dshbg-number"
              type="number"
              min={INTERVAL_MIN}
              max={INTERVAL_MAX}
              value={interval}
              aria-label="Minutes per background"
              disabled={!rotating}
              onChange={(e) => setIntervalText(e.target.value)}
              onBlur={commitInterval}
              onKeyDown={(e) => { if (e.key === 'Enter') commitInterval() }}
            />
            min
          </span>
          <SegmentedControl
            id="dshbg-order"
            label="Order"
            value={state.rotation.order}
            options={ORDER_OPTIONS}
            disabled={!rotating}
            onChange={(order) => { void client.send({ type: 'set-rotation', patch: { order } }) }}
          />
        </div>
      </section>
    </div>
  )
}
