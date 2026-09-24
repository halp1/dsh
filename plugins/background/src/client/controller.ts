/**
 * Glue between the library and the page: whenever the state changes (or the
 * rotation clock ticks), decide which image should be showing, show it, and
 * keep translucency in step. A broken image is skipped for the next pool item;
 * when every item fails the app goes back to opaque until the state changes.
 * @module
 */
import type { Appearance } from '../shared/state.ts'
import { buildPool, type PoolItem } from './pool.ts'
import { msUntilNext, pickIndex } from './rotation.ts'
import type { StateClient } from './state-client.ts'

/** What the controller drives. */
export interface ControllerDeps {
  client: StateClient
  stage: {
    current: PoolItem | undefined
    show(item: PoolItem): Promise<boolean>
    restyle(appearance: Appearance): void
    clear(): void
  }
  transparency: { enable(opacity: number): void; disable(): void }
  now?: () => number
  random?: () => number
}

/** The running controller. */
export interface Controller {
  /** The image currently shown, if any. */
  readonly current: PoolItem | undefined
  /** Re-evaluate now. */
  update(): void
  dispose(): void
}

const sameLook = (a: Appearance, b: Appearance) =>
  a.opacity === b.opacity && a.blur === b.blur && a.fit === b.fit && a.position === b.position

/**
 * Start driving the page from the client's snapshots.
 * @param deps - client, stage, transparency, and injectable clock/random.
 * @returns the controller.
 */
export function createController(deps: ControllerDeps): Controller {
  const now = deps.now ?? Date.now
  const random = deps.random ?? Math.random
  /** Folder picks stay stable for the page session. */
  const folderPicks = new Map<string, number>()
  const pick = (entryId: string, count: number) => {
    const existing = folderPicks.get(entryId)
    if (existing !== undefined && existing < count) return existing
    const index = Math.floor(random() * count)
    folderPicks.set(entryId, index)
    return index
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  /** Keys that failed to load; retried when the state changes. */
  let failed = new Set<string>()
  let lastRevision = -1
  let disposed = false

  const off = () => {
    deps.stage.clear()
    deps.transparency.disable()
  }

  const update = () => {
    if (disposed) return
    const gen = ++generation
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    const { state, info, status } = deps.client.getSnapshot()
    if (status === 'loading') return
    if (state.revision !== lastRevision) {
      failed = new Set()
      lastRevision = state.revision
    }
    const pool = buildPool(state, info, pick)
    if (pool.length === 0) {
      off()
      return
    }
    const seed = pool.map((p) => p.key).join('|')
    const start = state.rotation.enabled ? pickIndex(now(), state.rotation.intervalMin, pool.length, state.rotation.order, seed) : 0
    if (state.rotation.enabled && pool.length > 1) {
      timer = setTimeout(update, msUntilNext(now(), state.rotation.intervalMin) + 50)
    }

    const attempt = async (offset: number): Promise<void> => {
      if (offset >= pool.length) {
        if (gen === generation) off()
        return
      }
      const item = pool[(start + offset) % pool.length]!
      if (failed.has(item.key)) return attempt(offset + 1)
      const shown = deps.stage.current
      if (shown !== undefined && shown.url === item.url) {
        // Same image: only the look may have changed.
        if (!sameLook(shown.appearance, item.appearance)) deps.stage.restyle(item.appearance)
        deps.transparency.enable(item.appearance.opacity)
        return
      }
      const ok = await deps.stage.show(item)
      if (gen !== generation) return
      if (!ok) {
        failed.add(item.key)
        return attempt(offset + 1)
      }
      deps.transparency.enable(item.appearance.opacity)
    }
    void attempt(0)
  }

  const unsubscribe = deps.client.subscribe(update)
  update()

  return {
    get current() { return deps.stage.current },
    update,
    dispose() {
      disposed = true
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
      off()
    },
  }
}
