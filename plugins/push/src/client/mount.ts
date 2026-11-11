/**
 * Places one push button in every workspace row of the sidebar.
 *
 * ui-workspace offers no seat in the workspace header's action strip (its
 * slots are all per Session row), so the button is mounted into the strip's
 * DOM. Each workspace row is `[data-row-key="workspace:<id>"]` and its strip
 * holds the "..." trigger (`[data-context-menu-trigger]`) followed by the
 * New Session button. A host element goes right after the trigger and owns a
 * React root of its own. React never sees the host element, and a mutation
 * observer re-places it whenever the sidebar re-renders the row.
 * @module
 */

/** Row attribute prefix ui-workspace writes on workspace headers. */
export const ROW_PREFIX = 'workspace:'
export const HOST_ATTR = 'data-dshpush-host'
const ROW_SELECTOR = `[data-row-key^="${ROW_PREFIX}"]`
const TRIGGER_SELECTOR = '[data-context-menu-trigger]'

/** Renders and tears down one button inside a host element. */
export interface ButtonRenderer {
  mount(host: HTMLElement, workspaceId: string, hostClass: string): () => void
}

/**
 * Workspace id of one header row, or undefined for rows that are not
 * registered workspaces (Ungrouped has no "..." trigger and is skipped too).
 * @param key - the row's data-row-key.
 */
export function workspaceIdOf(key: string | null): string | undefined {
  if (key === null || !key.startsWith(ROW_PREFIX)) return undefined
  const id = key.slice(ROW_PREFIX.length)
  return id === '' ? undefined : id
}

/** The "..." trigger that belongs to this row, not to a nested workspace row. */
function ownTrigger(row: Element): Element | undefined {
  for (const trigger of row.querySelectorAll(TRIGGER_SELECTOR)) {
    if (trigger.closest(ROW_SELECTOR) === row) return trigger
  }
  return undefined
}

interface Mounted {
  host: HTMLElement
  workspaceId: string
  unmount: () => void
}

/**
 * Keep buttons in every eligible row under `root`.
 * @param root - the document (or any subtree) to watch.
 * @param renderer - mounts one button.
 * @param eligible - whether a workspace id gets a button (known to the host).
 * @returns a controller with a manual `sync` and `dispose`.
 */
export function installRowButtons(root: ParentNode & Node, renderer: ButtonRenderer, eligible: (workspaceId: string) => boolean) {
  const doc = root.ownerDocument ?? (root as Document)
  const mounted = new Map<Element, Mounted>()
  let scheduled = false
  let disposed = false

  const sync = () => {
    scheduled = false
    if (disposed) return
    const seen = new Set<Element>()
    for (const row of root.querySelectorAll(ROW_SELECTOR)) {
      const workspaceId = workspaceIdOf(row.getAttribute('data-row-key'))
      const trigger = ownTrigger(row)
      if (workspaceId === undefined || trigger === undefined || !eligible(workspaceId)) continue
      seen.add(row)
      let entry = mounted.get(row)
      if (entry !== undefined && entry.workspaceId !== workspaceId) {
        entry.unmount()
        entry.host.remove()
        entry = undefined
      }
      if (entry === undefined) {
        const host = doc.createElement('span')
        host.setAttribute(HOST_ATTR, workspaceId)
        host.className = 'dshpush-host'
        const hostClass = typeof trigger.className === 'string' ? trigger.className : ''
        entry = { host, workspaceId, unmount: renderer.mount(host, workspaceId, hostClass) }
        mounted.set(row, entry)
      }
      // Right after the "..." trigger, before New Session.
      if (trigger.nextSibling !== entry.host) trigger.after(entry.host)
    }
    for (const [row, entry] of mounted) {
      if (seen.has(row)) continue
      entry.unmount()
      entry.host.remove()
      mounted.delete(row)
    }
  }

  const schedule = () => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(sync)
  }

  const observer = new MutationObserver((records) => {
    // Our own insertions would otherwise wake the observer forever.
    if (records.every(record => isOwn(record))) return
    schedule()
  })
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-row-key'] })
  sync()

  return {
    sync: schedule,
    dispose() {
      disposed = true
      observer.disconnect()
      for (const entry of mounted.values()) {
        entry.unmount()
        entry.host.remove()
      }
      mounted.clear()
    },
  }
}

/** A change inside a button, or a host element being placed or moved. */
function isOwn(record: MutationRecord): boolean {
  if (insideHost(record.target)) return true
  if (record.type !== 'childList') return false
  const nodes = [...record.addedNodes, ...record.removedNodes]
  return nodes.length > 0 && nodes.every(node => node.nodeType === 1 && (node as Element).hasAttribute(HOST_ATTR))
}

function insideHost(node: Node): boolean {
  const element = node.nodeType === 1 ? node as Element : node.parentElement
  return element?.closest(`[${HOST_ATTR}]`) != null
}
