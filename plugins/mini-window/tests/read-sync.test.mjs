import test from 'node:test'
import assert from 'node:assert/strict'
import { readInMini, syncReadState, VIEW_SKEW_MS } from '../src/client/read-sync.ts'

test('a chat counts as read only when the mini window showed it after it finished', () => {
  const since = new Map([['read', 1000], ['stale', 5000], ['never', 1000]])
  assert.deepEqual(readInMini(since, { read: 1200, stale: 3000 }), ['read'])
  assert.deepEqual(readInMini(since, { stale: 5000 - VIEW_SKEW_MS }), ['stale'])
  assert.deepEqual(readInMini(since, undefined), [])
  // A reloaded main window first sees the dot after the mini view; last activity decides instead.
  assert.deepEqual(readInMini(new Map([['reloaded', 9000]]), { reloaded: 4000 }, () => 3500), ['reloaded'])
  assert.deepEqual(readInMini(new Map([['newer', 9000]]), { newer: 4000 }, () => 8000), [])
})

function statusStore(unread) {
  const listeners = new Set()
  const store = {
    completionUnread: new Set(unread), published: 0,
    publishStatus() { store.published++; for (const fn of [...listeners]) fn() },
    sessionStatus: {
      getSnapshot: () => new Map([...store.completionUnread].map(id => [id, { completionUnread: true }])),
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    },
  }
  return store
}

test('the main window clears dots the mini window already read, and leaves the rest', () => {
  let clock = 1000, viewed = {}
  const viewers = new Set()
  const store = statusStore(['a', 'b'])
  const dispose = syncReadState(store, () => viewed, fn => { viewers.add(fn); return () => viewers.delete(fn) }, () => undefined, () => clock)
  assert.deepEqual([...store.completionUnread].sort(), ['a', 'b'])
  clock = 2000; viewed = { a: 1500 }
  for (const fn of viewers) fn()
  assert.deepEqual([...store.completionUnread], ['b'])
  assert.equal(store.published, 1)
  dispose()
  viewed = { a: 1500, b: 1500 }
  assert.equal(viewers.size, 0)
})

test('an unexpected ui-session shape degrades to a no-op instead of throwing', () => {
  const store = { sessionStatus: { getSnapshot: () => new Map([['a', { completionUnread: true }]]), subscribe: () => () => {} } }
  assert.doesNotThrow(() => syncReadState(store, () => ({ a: Date.now() + 10000 }), () => () => {})())
})
