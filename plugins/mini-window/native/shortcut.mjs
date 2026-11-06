/** Register the replacement before releasing the old shortcut. Never discard a working binding on failure. */
export function replaceShortcut(registry, previous, next, callback) {
  if (previous === next) return { ok: true, activeShortcut: previous, shortcutRegistered: Boolean(previous) }
  if (next) {
    try {
      if (!registry.register(next, callback)) return { ok: false, activeShortcut: previous, shortcutRegistered: Boolean(previous), error: `The global shortcut ${next} is unavailable. Choose another shortcut in Settings.` }
    } catch {
      return { ok: false, activeShortcut: previous, shortcutRegistered: Boolean(previous), error: `Could not register ${next}. Choose another shortcut in Settings.` }
    }
  }
  if (previous) {
    try { registry.unregister(previous) } catch {
      if (next) { try { registry.unregister(next) } catch {} }
      return { ok: false, activeShortcut: previous, shortcutRegistered: true, error: 'Could not release the previous global shortcut.' }
    }
  }
  return { ok: true, activeShortcut: next, shortcutRegistered: Boolean(next) }
}
