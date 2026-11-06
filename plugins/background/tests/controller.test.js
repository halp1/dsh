/**
 * Controller decisions with a fake stage, transparency, and client.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createController } from '../src/client/controller.ts'
import { emptyState } from '../src/shared/state.ts'

const url = (id, over = {}) => ({ id, kind: 'url', source: `https://x.test/${id}.png`, inRotation: true, ...over })

function harness(state, { broken = [] } = {}) {
  let snapshot = { status: 'ready', state, info: { folders: {}, files: {} } }
  const listeners = new Set()
  const client = {
    getSnapshot: () => snapshot,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
    set(next) { snapshot = { ...snapshot, state: next }; for (const l of listeners) l() },
  }
  const log = []
  const stage = {
    current: undefined,
    async show(item) {
      log.push(['show', item.entryId])
      if (broken.includes(item.entryId)) return false
      this.current = item
      return true
    },
    restyle(a) { log.push(['restyle', a.blur]); this.current = { ...this.current, appearance: a } },
    clear() { log.push(['clear']); this.current = undefined },
  }
  const transparency = { enable: (o) => log.push(['enable', o]), disable: () => log.push(['disable']) }
  return { client, stage, transparency, log }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

test('nothing active → opaque, no stage', async () => {
  const h = harness({ ...emptyState(), entries: [url('a')] })
  const c = createController(h)
  await flush()
  assert.deepEqual(h.log, [['clear'], ['disable']])
  c.dispose()
})

test('active entry → shown, then translucency at its opacity', async () => {
  const h = harness({ ...emptyState(), entries: [url('a', { overrides: { opacity: 0.6 } })], activeId: 'a' })
  const c = createController(h)
  await flush()
  assert.deepEqual(h.log, [['show', 'a'], ['enable', 0.6]])
  assert.equal(c.current.entryId, 'a')
  c.dispose()
})

test('an appearance-only change restyles without reloading', async () => {
  const state = { ...emptyState(), entries: [url('a')], activeId: 'a' }
  const h = harness(state)
  const c = createController(h)
  await flush()
  h.client.set({ ...state, revision: 1, appearance: { ...state.appearance, blur: 8 } })
  await flush()
  assert.deepEqual(h.log.slice(2), [['restyle', 8], ['enable', 0.85]])
  c.dispose()
})

test('a broken image is skipped for the next rotation item', async () => {
  const state = {
    ...emptyState(),
    entries: [url('a'), url('b')],
    rotation: { enabled: true, intervalMin: 60, order: 'sequential' },
  }
  const h = harness(state, { broken: ['a', 'b'].filter((id) => id === 'a') })
  const c = createController({ ...h, now: () => 0 })
  await flush(); await flush()
  assert.deepEqual(h.log, [['show', 'a'], ['show', 'b'], ['enable', 0.85]])
  c.dispose()
})

test('when every image fails the app returns to opaque', async () => {
  const h = harness({ ...emptyState(), entries: [url('a')], activeId: 'a' }, { broken: ['a'] })
  const c = createController(h)
  await flush(); await flush()
  assert.deepEqual(h.log, [['show', 'a'], ['clear'], ['disable']])
  c.dispose()
})
