/**
 * Host filesystem side of the library: classify what the user typed into the
 * Add field, and list a folder entry's images.
 *
 * Folder listings are the only place a filename is derived from disk rather
 * than from a stored entry, so this is where containment is enforced: an
 * entry (including a symlink) whose real path leaves the folder is skipped.
 * @module
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import { IMAGE_EXTENSIONS, type EntryKind } from '../shared/state.ts'

/** A validation failure whose message is shown to the user as-is. */
export class SourceError extends Error {
  override name = 'SourceError'
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

/**
 * Whether the input is a remote image URL.
 * @param input - trimmed user input.
 * @returns true for http: and https: URLs only.
 */
export function isUrl(input: string): boolean {
  if (!/^https?:\/\//i.test(input)) return false
  try {
    const url = new URL(input)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Expand a leading `~` or `~/` against the home directory.
 * @param path - the configured path.
 * @param home - home directory (defaults to the OS home).
 * @returns the expanded path; `~user` forms are left alone.
 */
export function expandHome(path: string, home: string = homedir()): string {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return path
}

/**
 * Whether the path carries a supported image extension.
 * @param path - any path.
 * @returns true for the {@link IMAGE_EXTENSIONS} set, case-insensitively.
 */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase())
}

/**
 * Response content type for an image path.
 * @param path - a path accepted by {@link isImagePath}.
 * @returns the MIME type, or `application/octet-stream`.
 */
export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/**
 * The images directly inside a folder, sorted by name. Subfolders are ignored,
 * and so is anything (typically a symlink) whose real path is outside the
 * folder's real path.
 * @param dir - absolute folder path.
 * @returns absolute paths (as spelled inside `dir`).
 */
export async function listFolderImages(dir: string): Promise<string[]> {
  const root = await realpath(dir)
  const names = (await readdir(dir)).filter(isImagePath).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  const out: string[] = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      const real = await realpath(path)
      if (!inside(real, root)) continue
      if (!(await stat(real)).isFile()) continue
      out.push(path)
    } catch {
      // Dangling symlink or a file removed mid-listing.
    }
  }
  return out
}

/**
 * Check that a stored file path is still safe to serve: it exists, is a
 * regular image file, and (for folder entries) resolves inside the folder.
 * @param path - the candidate path.
 * @param folder - the owning folder, for folder entries.
 * @returns the real path to open, or undefined.
 */
export async function servablePath(path: string, folder?: string): Promise<string | undefined> {
  if (!isImagePath(path)) return undefined
  try {
    const real = await realpath(path)
    if (folder !== undefined && !inside(real, await realpath(folder))) return undefined
    return (await stat(real)).isFile() ? real : undefined
  } catch {
    return undefined
  }
}

/**
 * Validate and classify an Add-field input.
 * @param input - trimmed user input: a URL or a host path.
 * @returns the entry kind and canonical source.
 * @throws SourceError with a user-facing message.
 */
export async function resolveSource(input: string): Promise<{ kind: EntryKind; source: string }> {
  const trimmed = input.trim()
  if (isUrl(trimmed)) return { kind: 'url', source: trimmed }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new SourceError('Only http:// and https:// URLs are supported')
  }
  const expanded = expandHome(trimmed)
  if (!isAbsolute(expanded)) {
    throw new SourceError('Use an absolute path (or one starting with ~/), or an http(s) URL')
  }
  const path = resolve(expanded)
  let info
  try {
    info = await stat(path)
  } catch {
    throw new SourceError(`${path} does not exist`)
  }
  if (info.isDirectory()) {
    let images: string[]
    try {
      images = await listFolderImages(path)
    } catch {
      throw new SourceError(`${path} cannot be read`)
    }
    if (images.length === 0) throw new SourceError(`${path} has no images (png, jpg, webp, gif, avif, svg)`)
    return { kind: 'folder', source: path }
  }
  if (!info.isFile() || !isImagePath(path)) {
    throw new SourceError(`${path} is not a supported image (png, jpg, webp, gif, avif, svg)`)
  }
  return { kind: 'file', source: path }
}
