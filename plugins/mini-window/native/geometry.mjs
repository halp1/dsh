import { COMPACT_SIZE, EXPANDED_SIZE, MIN_EXPANDED_SIZE, normalizeBounds } from '../shared/state.mjs'

const finiteArea = area => area && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(area[k])) && area.width > 0 && area.height > 0

/** Clamp both size and origin, including negative-origin and very small displays. */
export function clampBounds(bounds, workArea) {
  if (!finiteArea(workArea)) throw new Error('A valid display work area is required.')
  const input = normalizeBounds(bounds)
  if (!input) throw new Error('Valid window bounds are required.')
  const width = Math.min(input.width, Math.floor(workArea.width))
  const height = Math.min(input.height, Math.floor(workArea.height))
  return {
    x: Math.round(Math.max(workArea.x, Math.min(input.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(input.y, workArea.y + workArea.height - height))),
    width,
    height,
  }
}

export function initialBounds(settings, workArea) {
  const remembered = normalizeBounds(settings.expanded ? settings.expandedBounds || settings.bounds : settings.bounds)
  const size = settings.expanded ? EXPANDED_SIZE : COMPACT_SIZE
  const fallback = {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height - size.height - 24),
    ...size,
  }
  return boundsForMode(remembered || fallback, settings.expandedBounds, settings.expanded, workArea)
}

/** Expansion remembers its size; dragging the compact window relocates the next expansion. */
export function boundsForMode(current, expandedBounds, expanded, workArea) {
  const remembered = normalizeBounds(expandedBounds)
  const size = expanded
    ? { width: Math.max(MIN_EXPANDED_SIZE.width, remembered?.width || EXPANDED_SIZE.width), height: Math.max(MIN_EXPANDED_SIZE.height, remembered?.height || EXPANDED_SIZE.height) }
    : COMPACT_SIZE
  return clampBounds({ x: current.x, y: current.y, ...size }, workArea)
}

export function geometryPatch(bounds, remembered, expanded) {
  const normalized = normalizeBounds(bounds)
  if (!normalized) throw new Error('Valid window bounds are required.')
  const previous = normalizeBounds(remembered)
  return {
    bounds: normalized,
    expandedBounds: expanded ? { ...normalized } : previous ? { ...previous, x: normalized.x, y: normalized.y } : null,
    expanded: Boolean(expanded),
  }
}
