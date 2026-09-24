/**
 * Which images are eligible to show right now, and in what order. Pure: the
 * folder random pick is injected so tests (and a page session) control it.
 * @module
 */
import { mergeAppearance, type Appearance, type Entry, type State } from '../shared/state.ts'

/** One showable image. */
export interface PoolItem {
  /** Stable identity (`<entryId>#<index>`), used for shuffle seeding and dedupe. */
  key: string
  entryId: string
  /** Image index within a folder entry; 0 otherwise. */
  index: number
  /** What the stage loads: the remote URL, or the host file route. */
  url: string
  /** Global appearance merged with the entry's overrides. */
  appearance: Appearance
}

/** Folder listings and file health, as returned by the state route. */
export interface SourceInfo {
  folders: Record<string, { count: number; names?: string[] } | { error: string }>
  files: Record<string, { ok: boolean }>
}

/** Picks one image index from a folder of `count` images. */
export type FolderPicker = (entryId: string, count: number) => number

/**
 * The host route serving a local entry's image.
 * @param entryId - entry id.
 * @param index - folder image index (0 for files).
 * @returns a URL relative to the app, like the host's own `api/...` calls.
 */
export function fileUrl(entryId: string, index: number): string {
  return `api/dsh-background.file?entry=${encodeURIComponent(entryId)}&i=${index}`
}

function folderCount(info: SourceInfo, id: string): number {
  const folder = info.folders[id]
  return folder !== undefined && 'count' in folder ? folder.count : 0
}

function items(entry: Entry, state: State, info: SourceInfo, expandFolder: boolean, pick: FolderPicker): PoolItem[] {
  const appearance = mergeAppearance(state.appearance, entry.overrides)
  const make = (index: number, url: string): PoolItem => ({ key: `${entry.id}#${index}`, entryId: entry.id, index, url, appearance })
  switch (entry.kind) {
    case 'url':
      return [make(0, entry.source)]
    case 'file':
      return info.files[entry.id]?.ok === false ? [] : [make(0, fileUrl(entry.id, 0))]
    case 'folder': {
      const count = folderCount(info, entry.id)
      if (count === 0) return []
      if (expandFolder) return Array.from({ length: count }, (_, i) => make(i, fileUrl(entry.id, i)))
      const index = Math.min(count - 1, Math.max(0, Math.floor(pick(entry.id, count))))
      return [make(index, fileUrl(entry.id, index))]
    }
  }
}

/**
 * Build the pool. Rotation off → the active entry (a folder contributes one
 * picked image). Rotation on → every `inRotation` entry, folders expanded;
 * when that set is empty, falls back to the active entry.
 * @param state - the library.
 * @param info - folder counts and file health.
 * @param pick - folder image picker for the non-rotating case.
 * @returns images in library order.
 */
export function buildPool(state: State, info: SourceInfo, pick: FolderPicker): PoolItem[] {
  const active = state.entries.find((e) => e.id === state.activeId)
  if (state.rotation.enabled) {
    const pool = state.entries.filter((e) => e.inRotation).flatMap((e) => items(e, state, info, true, pick))
    if (pool.length > 0) return pool
  }
  return active === undefined ? [] : items(active, state, info, false, pick)
}
