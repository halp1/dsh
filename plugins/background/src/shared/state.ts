/**
 * The background library's data model, shared by both halves.
 *
 * Everything that crosses a trust boundary (the state file on disk, a POST
 * body, a server response) goes through {@link normalizeState} or
 * {@link normalizeOp}, so the rest of the code can rely on clamped numbers,
 * valid enums, and unique entry ids. {@link applyOp} is the only mutation path
 * and is pure, which lets the browser apply an edit optimistically with the
 * exact rules the host will use.
 * @module
 */

/** How the image fills the viewport. `stretch` ignores the aspect ratio. */
export type Fit = 'cover' | 'contain' | 'stretch' | 'tile'
/** Which part of the image stays visible when it is cropped. */
export type Position = 'center' | 'top' | 'bottom' | 'left' | 'right'
/** Rotation order: sequential walks the pool, shuffle permutes it per cycle. */
export type RotationOrder = 'sequential' | 'shuffle'
/** Where an entry's images come from. */
export type EntryKind = 'url' | 'file' | 'folder'

/** Presentation knobs, global or per entry. */
export interface Appearance {
  /** Alpha of the app's surfaces over the background, 0.30–1.00. */
  opacity: number
  /** Blur applied to the image in px, 0–40. */
  blur: number
  fit: Fit
  position: Position
}

/** One library item. */
export interface Entry {
  /** Random 12-char base36 id. */
  id: string
  kind: EntryKind
  /** The URL, or an absolute host path (already `~`-expanded). */
  source: string
  /** Display name; absent means derive one from `source`. */
  label?: string
  /** Whether rotation includes this entry. */
  inRotation: boolean
  /** Per-entry appearance that replaces the global one while shown. */
  overrides?: Partial<Appearance>
}

/** Slideshow settings. */
export interface Rotation {
  enabled: boolean
  /** Minutes per image, 1–1440. */
  intervalMin: number
  order: RotationOrder
}

/** The whole persisted library. */
export interface State {
  version: 1
  /** Incremented by the host on every save; guards concurrent writers. */
  revision: number
  entries: Entry[]
  activeId: string | null
  appearance: Appearance
  rotation: Rotation
}

/** Patch accepted by `update-entry`; `overrides: null` clears them. */
export interface EntryPatch {
  label?: string
  inRotation?: boolean
  overrides?: Partial<Appearance> | null
}

/** One mutation, as posted by the browser. */
export type Op =
  | { type: 'add'; source: string; label?: string }
  | { type: 'remove'; id: string }
  | { type: 'update-entry'; id: string; patch: EntryPatch }
  | { type: 'set-active'; id: string | null }
  | { type: 'set-appearance'; patch: Partial<Appearance> }
  | { type: 'set-rotation'; patch: Partial<Rotation> }

/** File extensions served and accepted as images (lowercase, with dot). */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg',
])

export const OPACITY_MIN = 0.3
export const OPACITY_MAX = 1
export const BLUR_MAX = 40
export const INTERVAL_MIN = 1
export const INTERVAL_MAX = 1440

export const FITS: readonly Fit[] = ['cover', 'contain', 'stretch', 'tile']
export const POSITIONS: readonly Position[] = ['center', 'top', 'bottom', 'left', 'right']
export const ORDERS: readonly RotationOrder[] = ['sequential', 'shuffle']
const KINDS: readonly EntryKind[] = ['url', 'file', 'folder']

export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze({
  opacity: 0.85,
  blur: 0,
  fit: 'cover',
  position: 'center',
})

export const DEFAULT_ROTATION: Readonly<Rotation> = Object.freeze({
  enabled: false,
  intervalMin: 15,
  order: 'shuffle',
})

/** A fresh, empty library. */
export function emptyState(): State {
  return {
    version: 1,
    revision: 0,
    entries: [],
    activeId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    rotation: { ...DEFAULT_ROTATION },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined
}

/**
 * Keep only the valid fields of an appearance patch.
 * @param raw - untrusted patch.
 * @returns the fields that survived, clamped.
 */
export function normalizeAppearancePatch(raw: unknown): Partial<Appearance> {
  if (!isRecord(raw)) return {}
  const out: Partial<Appearance> = {}
  const opacity = clamp(raw.opacity, OPACITY_MIN, OPACITY_MAX)
  if (opacity !== undefined) out.opacity = Math.round(opacity * 100) / 100
  const blur = clamp(raw.blur, 0, BLUR_MAX)
  if (blur !== undefined) out.blur = Math.round(blur)
  const fit = oneOf(raw.fit, FITS)
  if (fit !== undefined) out.fit = fit
  const position = oneOf(raw.position, POSITIONS)
  if (position !== undefined) out.position = position
  return out
}

function normalizeRotationPatch(raw: unknown): Partial<Rotation> {
  if (!isRecord(raw)) return {}
  const out: Partial<Rotation> = {}
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  const interval = clamp(raw.intervalMin, INTERVAL_MIN, INTERVAL_MAX)
  if (interval !== undefined) out.intervalMin = Math.round(interval)
  const order = oneOf(raw.order, ORDERS)
  if (order !== undefined) out.order = order
  return out
}

function normalizeEntry(raw: unknown): Entry | undefined {
  if (!isRecord(raw)) return undefined
  const kind = oneOf(raw.kind, KINDS)
  if (typeof raw.id !== 'string' || raw.id === '' || kind === undefined) return undefined
  if (typeof raw.source !== 'string' || raw.source === '') return undefined
  const entry: Entry = { id: raw.id, kind, source: raw.source, inRotation: raw.inRotation !== false }
  if (typeof raw.label === 'string' && raw.label.trim() !== '') entry.label = raw.label.trim()
  const overrides = normalizeAppearancePatch(raw.overrides)
  if (Object.keys(overrides).length > 0) entry.overrides = overrides
  // Keep key order stable (id, kind, source, label, inRotation, overrides).
  const { id, source, label, inRotation } = entry
  return {
    id,
    kind,
    source,
    ...(label === undefined ? {} : { label }),
    inRotation,
    ...(entry.overrides === undefined ? {} : { overrides: entry.overrides }),
  }
}

/**
 * Coerce anything into a valid {@link State}.
 * @param raw - parsed JSON from disk or the network.
 * @returns a valid state; garbage becomes the empty state.
 */
export function normalizeState(raw: unknown): State {
  const state = emptyState()
  if (!isRecord(raw)) return state
  if (typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 0) {
    state.revision = raw.revision
  }
  if (Array.isArray(raw.entries)) {
    const seen = new Set<string>()
    for (const item of raw.entries) {
      const entry = normalizeEntry(item)
      if (entry === undefined || seen.has(entry.id)) continue
      seen.add(entry.id)
      state.entries.push(entry)
    }
  }
  if (typeof raw.activeId === 'string' && state.entries.some((e) => e.id === raw.activeId)) {
    state.activeId = raw.activeId
  }
  state.appearance = { ...DEFAULT_APPEARANCE, ...normalizeAppearancePatch(raw.appearance) }
  state.rotation = { ...DEFAULT_ROTATION, ...normalizeRotationPatch(raw.rotation) }
  return state
}

/**
 * Validate a posted op.
 * @param raw - untrusted op.
 * @returns the op, or undefined when malformed.
 */
export function normalizeOp(raw: unknown): Op | undefined {
  if (!isRecord(raw)) return undefined
  switch (raw.type) {
    case 'add': {
      if (typeof raw.source !== 'string' || raw.source.trim() === '') return undefined
      const op: Op = { type: 'add', source: raw.source.trim() }
      if (typeof raw.label === 'string' && raw.label.trim() !== '') op.label = raw.label.trim()
      return op
    }
    case 'remove':
      return typeof raw.id === 'string' ? { type: 'remove', id: raw.id } : undefined
    case 'update-entry': {
      if (typeof raw.id !== 'string' || !isRecord(raw.patch)) return undefined
      const patch: EntryPatch = {}
      if (typeof raw.patch.label === 'string') patch.label = raw.patch.label
      if (typeof raw.patch.inRotation === 'boolean') patch.inRotation = raw.patch.inRotation
      if (raw.patch.overrides === null) patch.overrides = null
      else if (isRecord(raw.patch.overrides)) patch.overrides = normalizeAppearancePatch(raw.patch.overrides)
      return { type: 'update-entry', id: raw.id, patch }
    }
    case 'set-active':
      if (raw.id === null || typeof raw.id === 'string') return { type: 'set-active', id: raw.id }
      return undefined
    case 'set-appearance':
      return isRecord(raw.patch) ? { type: 'set-appearance', patch: normalizeAppearancePatch(raw.patch) } : undefined
    case 'set-rotation':
      return isRecord(raw.patch) ? { type: 'set-rotation', patch: normalizeRotationPatch(raw.patch) } : undefined
    default:
      return undefined
  }
}

/**
 * The appearance in effect for one entry.
 * @param global - the library-wide appearance.
 * @param overrides - the entry's overrides, if any.
 * @returns overrides layered over the global appearance.
 */
export function mergeAppearance(global: Appearance, overrides: Partial<Appearance> | undefined): Appearance {
  return overrides === undefined ? { ...global } : { ...global, ...overrides }
}

/**
 * Apply one op, returning a new state (the input is never mutated). The
 * revision is left alone; the host bumps it on save.
 * @param state - the current state.
 * @param op - a normalized op.
 * @param added - for `add`, the entry the host validated from `op.source`.
 * @returns the next state.
 */
export function applyOp(state: State, op: Op, added?: Entry): State {
  const next: State = {
    ...state,
    entries: state.entries.map((e) => ({ ...e })),
    appearance: { ...state.appearance },
    rotation: { ...state.rotation },
  }
  switch (op.type) {
    case 'add':
      if (added !== undefined && !next.entries.some((e) => e.id === added.id)) next.entries.push({ ...added })
      break
    case 'remove':
      next.entries = next.entries.filter((e) => e.id !== op.id)
      if (next.activeId === op.id) next.activeId = null
      break
    case 'update-entry': {
      const target = next.entries.find((e) => e.id === op.id)
      if (target === undefined) break
      if (op.patch.label !== undefined) {
        const label = op.patch.label.trim()
        if (label === '') delete target.label
        else target.label = label
      }
      if (op.patch.inRotation !== undefined) target.inRotation = op.patch.inRotation
      if (op.patch.overrides === null) delete target.overrides
      else if (op.patch.overrides !== undefined) {
        const overrides = normalizeAppearancePatch(op.patch.overrides)
        if (Object.keys(overrides).length === 0) delete target.overrides
        else target.overrides = overrides
      }
      break
    }
    case 'set-active':
      if (op.id === null || next.entries.some((e) => e.id === op.id)) next.activeId = op.id
      break
    case 'set-appearance':
      next.appearance = { ...next.appearance, ...normalizeAppearancePatch(op.patch) }
      break
    case 'set-rotation':
      next.rotation = { ...next.rotation, ...normalizeRotationPatch(op.patch) }
      break
  }
  return next
}

/**
 * A random entry id.
 * @returns 12 base36 characters.
 */
export function newEntryId(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('')
}

/**
 * The name shown for an entry.
 * @param entry - the entry.
 * @returns its label, or the last path segment / URL filename.
 */
export function entryLabel(entry: Entry): string {
  if (entry.label !== undefined) return entry.label
  if (entry.kind === 'url') {
    try {
      const url = new URL(entry.source)
      const tail = url.pathname.split('/').filter(Boolean).pop()
      return tail === undefined ? url.host : decodeURIComponent(tail)
    } catch {
      return entry.source
    }
  }
  const parts = entry.source.split(/[\\/]/).filter(Boolean)
  return parts.pop() ?? entry.source
}
