import { normalizeBounds, validatePatch } from '../../shared/state.mjs'
import { sanitizeError } from './runtime.mjs'

export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export class MiniWindowController {
  constructor(store, native) {
    this.store = store; this.native = native; this.queue = Promise.resolve(); this.disposed = false
    /** sessionId -> host time the mini window last showed it at rest (expanded, visible, not running). */
    this.viewed = new Map()
    this.loaded = store.load()
    // Capture load errors for GET without silently overwriting a broken state file.
    this.loaded.catch((error) => native.error(error))
    native.options.onGeometry = (patch) => { this.geometry(patch).catch((error) => native.error(error)) }
  }
  snapshot() { return { state: structuredClone(this.store.current), runtime: { ...this.native.runtime }, viewed: Object.fromEntries(this.viewed) } }
  /** Record that the mini window displayed a finished session, so other windows can clear its unread dot. */
  markViewed(body) {
    const id = body?.sessionId
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof id !== 'string' || !id || id.length > 256) throw new RequestError(400, 'Expected { sessionId }.')
    this.viewed.delete(id)
    this.viewed.set(id, Date.now())
    while (this.viewed.size > 200) this.viewed.delete(this.viewed.keys().next().value)
    return this.snapshot()
  }
  serialize(action) {
    const result = this.queue.then(async () => {
      if (this.disposed) throw new RequestError(503, 'Mini-window plugin has been disposed.')
      await this.loaded
      return action()
    })
    this.queue = result.catch(() => {})
    return result
  }
  activate() {
    return this.serialize(async () => { if (this.store.current.enabled) await this.native.start(this.store.current) })
  }
  async get() { await this.loaded.catch(() => {}); return this.snapshot() }
  mutate(body) {
    return this.serialize(async () => {
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0 || Object.keys(body).some(k => !['baseRevision', 'patch'].includes(k))) throw new RequestError(400, 'Expected { baseRevision, patch }.')
      let patch
      try { patch = validatePatch(body.patch) } catch (error) { throw new RequestError(400, error.message) }
      const previous = this.store.current
      if (body.baseRevision !== previous.revision) return { status: 409, snapshot: this.snapshot() }
      const next = { ...previous, ...patch }
      if (Object.keys(patch).every(key => previous[key] === patch[key])) return { status: 200, snapshot: this.snapshot() }
      let configured = false
      const wasRunning = this.native.runtime.status === 'ready'
      try {
        // Native registers the new shortcut before releasing the old one. Persist
        // only after it acknowledges, so conflicts cannot corrupt saved settings.
        if (wasRunning && (next.shortcut !== previous.shortcut || next.enabled !== previous.enabled)) { await this.native.command('configure', next); configured = true }
        else if (next.enabled && (next.shortcut !== previous.shortcut || !previous.enabled)) {
          await this.native.start(next)
          // Bootstrap can be ready while reporting a shortcut conflict. Require
          // an acknowledged configure before committing an enabled shortcut.
          await this.native.command('configure', next)
          configured = true
        }
      } catch (error) {
        if (!wasRunning && this.native.runtime.status === 'ready') {
          try {
            if (previous.enabled) await this.native.command('configure', previous)
            else await this.native.stop()
          } catch { await this.native.stop() }
        }
        this.native.runtime = { ...this.native.runtime, error: sanitizeError(error, this.native.secretURL) }
        return { status: 422, snapshot: this.snapshot() }
      }
      try { await this.store.save(next) }
      catch (error) {
        // Restore native settings if disk commit failed, including the old hotkey.
        if (configured) {
          try {
            if (wasRunning) await this.native.command('configure', previous)
            else await this.native.stop()
          } catch { await this.native.stop() }
        }
        throw error
      }
      if (!next.enabled) await this.native.stop()
      return { status: 200, snapshot: this.snapshot() }
    })
  }
  geometry(value) {
    return this.serialize(async () => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      const patch = {}
      for (const key of ['bounds', 'expandedBounds']) {
        if (value[key] === undefined) continue
        const bounds = normalizeBounds(value[key])
        if (bounds) patch[key] = bounds
      }
      if (typeof value.expanded === 'boolean') patch.expanded = value.expanded
      if (!Object.keys(patch).length || Object.keys(patch).every(key => JSON.stringify(patch[key]) === JSON.stringify(this.store.current[key]))) return
      await this.store.save({ ...this.store.current, ...patch })
    })
  }
  command(body) {
    return this.serialize(async () => {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !['show', 'hide', 'restart', 'quit'].includes(body.command)) throw new RequestError(400, 'Expected command: show, hide, restart, or quit.')
      const command = body.command
      if (command === 'quit') await this.native.stop()
      else if (command === 'restart') { await this.native.stop(); if (this.store.current.enabled) await this.native.start(this.store.current) }
      else if (command === 'show') {
        if (!this.store.current.enabled) throw new RequestError(400, 'The mini window is disabled. Enable it in Settings first.')
        await this.native.start(this.store.current); await this.native.command('show')
      }
      else if (this.native.runtime.status === 'ready') await this.native.command('hide')
      return this.snapshot()
    })
  }
  async dispose() {
    this.disposed = true
    // Kill immediately, rejecting in-flight native commands; do not wait behind startup.
    await this.native.dispose()
    await this.queue
  }
}
