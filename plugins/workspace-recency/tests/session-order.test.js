import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../src/client/settings.ts'
import { installSessionOrder } from '../src/client/session-order.ts'

/** The ui-workspace view store: prototype methods plus a zustand-like `store.set`. */
class ViewStore {
  constructor(state) {
    this.state = state
    this.listeners = new Set()
    const self = this
    this.store = {
      set(next) {
        if (next === self.state) return
        self.state = next
        for (const fn of [...self.listeners]) fn()
      },
    }
  }
  getSnapshot() { return this.state }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
}

const manual = () => ({ orderBy: 'manual', groupBy: 'workspace', sessionOrderByAccount: { '': ['b', 'a'], w: ['s2', 's1'] } })

test('manual mode reads as recency order with stable identity and no writes', () => {
  const view = new ViewStore(manual())
  let woken = 0
  view.subscribe(() => { woken += 1 })
  const orderer = installSessionOrder(view, () => DEFAULT_SETTINGS)

  assert.equal(woken, 1, 'a sidebar that rendered first is woken')
  const read = view.getSnapshot()
  assert.equal(read.orderBy, 'updated')
  assert.equal(view.getSnapshot(), read)
  assert.equal(orderer.masking, true)
  assert.equal(view.state.orderBy, 'manual')
  assert.deepEqual(view.state.sessionOrderByAccount, manual().sessionOrderByAccount)

  view.store.set({ ...view.state, groupBy: 'flat' })
  assert.notEqual(view.getSnapshot(), read, 'a real store change yields a new snapshot')
  assert.equal(view.getSnapshot().orderBy, 'updated')
})

test('recency mode passes through untouched and wakes nobody', () => {
  const state = { orderBy: 'updated', sessionOrderByAccount: {} }
  const view = new ViewStore(state)
  let woken = 0
  view.subscribe(() => { woken += 1 })
  installSessionOrder(view, () => DEFAULT_SETTINGS)
  assert.equal(view.getSnapshot(), state)
  assert.equal(woken, 0)
})

for (const [label, patch] of [['sortSessions off', { sortSessions: false }], ['master switch off', { enabled: false }]]) {
  test(`${label} restores the saved Manual order after a refresh`, () => {
    let settings = { ...DEFAULT_SETTINGS }
    const view = new ViewStore(manual())
    const orderer = installSessionOrder(view, () => settings)
    let woken = 0
    view.subscribe(() => { woken += 1 })
    settings = { ...settings, ...patch }
    orderer.refresh()
    assert.equal(woken, 1)
    assert.equal(view.getSnapshot().orderBy, 'manual')
    assert.equal(orderer.masking, false)
  })
}

test('dispose removes the patch and re-renders the saved order', () => {
  const view = new ViewStore(manual())
  const orderer = installSessionOrder(view, () => DEFAULT_SETTINGS)
  orderer.dispose()
  assert.ok(!Object.hasOwn(view, 'getSnapshot'))
  assert.equal(view.getSnapshot().orderBy, 'manual')
})
