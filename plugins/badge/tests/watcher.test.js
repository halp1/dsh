/**
 * Watcher wiring: all three host sources drive the badge, and teardown is clean.
 *
 * The three-source requirement is the subtle part. A watcher bound only to the
 * session list would miss every approval and question (pure client state), and
 * one that skipped the workspace source would keep counting a finished session
 * the user archived.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BadgeApplier } from '../src/client/badge.ts'
import { installBadgeWatcher, readCount } from '../src/client/watcher.ts'
import { DEFAULT_SETTINGS } from '../src/client/settings.ts'

/** A minimal {getSnapshot, subscribe} source with a manual push. */
function source(initial) {
  const listeners = new Set()
  let value = initial
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { value = next; for (const l of [...listeners]) l() },
    get listenerCount() { return listeners.size },
  }
}

function session(id, overrides = {}) {
  return { id, displayTitle: id, blank: false, running: false, updatedAt: 0, ...overrides }
}

function list(summaries, current) {
  const byId = {}
  for (const s of summaries) byId[s.id] = s
  return {
    ids: summaries.map(s => s.id),
    byId,
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function pending(entries = {}) {
  return new Map(Object.entries(entries).map(([id, kind]) => [id, { key: `${id}-k`, kind, sessionId: id }]))
}

/** Assemble sources + a recording applier, with settings the test can mutate. */
function harness(summaries = [], { archived = [], interactions = {}, settings = DEFAULT_SETTINGS } = {}) {
  const calls = []
  const nav = {
    setAppBadge: async (n) => { calls.push(n) },
    clearAppBadge: async () => { calls.push(0) },
  }
  const sources = {
    sessions: source(list(summaries)),
    workspaces: source({ archivedSessionIds: archived }),
    pendingInteractions: source(pending(interactions)),
  }
  let live = { ...settings }
  const watcher = installBadgeWatcher(sources, {
    applier: new BadgeApplier(nav, undefined, () => live),
    getOptions: () => live,
  })
  return { sources, watcher, calls, setSettings: (patch) => { live = { ...live, ...patch } } }
}

test('publishes an initial count at install time', () => {
  const { watcher, calls } = harness([session('a', { completed: true })])
  assert.equal(watcher.count, 1)
  assert.deepEqual(calls, [1])
})

test('publishes an initial zero, clearing a stale badge', () => {
  const { calls } = harness([session('a')])
  assert.deepEqual(calls, [0])
})

test('follows session-list changes', () => {
  const h = harness([session('a')])
  h.sources.sessions.set(list([session('a', { completed: true })]))
  assert.equal(h.watcher.count, 1)
  assert.deepEqual(h.calls, [0, 1])
})

test('follows pending-interaction changes, which never appear in the session list', () => {
  const h = harness([session('a')])
  h.sources.pendingInteractions.set(pending({ a: 'approval' }))
  assert.equal(h.watcher.count, 1)
  h.sources.pendingInteractions.set(pending())
  assert.equal(h.watcher.count, 0)
  assert.deepEqual(h.calls, [0, 1, 0])
})

test('follows archive changes', () => {
  const h = harness([session('a', { completed: true })])
  h.sources.workspaces.set({ archivedSessionIds: ['a'] })
  assert.equal(h.watcher.count, 0)
  assert.deepEqual(h.calls, [1, 0])
})

test('does not re-hit the platform when a change leaves the count identical', () => {
  // The realistic case: a streaming turn invalidates the session snapshot many
  // times without changing anything the badge counts.
  const h = harness([session('a', { completed: true })])
  for (let i = 0; i < 20; i += 1) h.sources.sessions.set(list([session('a', { completed: true })]))
  assert.deepEqual(h.calls, [1])
})

test('disabling zeroes the badge without unsubscribing', () => {
  const h = harness([session('a', { completed: true })])
  h.setSettings({ enabled: false })
  h.watcher.refresh()
  assert.equal(h.watcher.count, 0)
  assert.deepEqual(h.calls, [1, 0])
  // Still bound: re-enabling recovers the live count.
  h.setSettings({ enabled: true })
  h.watcher.refresh()
  assert.equal(h.watcher.count, 1)
})

test('refresh forces a write even when the number is unchanged', () => {
  const h = harness([session('a', { completed: true })])
  h.watcher.refresh()
  assert.deepEqual(h.calls, [1, 1])
})

test('dispose unsubscribes every source and clears the badge', () => {
  const h = harness([session('a', { completed: true })])
  h.watcher.dispose()
  assert.deepEqual(h.calls, [1, 0])
  assert.equal(h.sources.sessions.listenerCount, 0)
  assert.equal(h.sources.workspaces.listenerCount, 0)
  assert.equal(h.sources.pendingInteractions.listenerCount, 0)
  // Post-dispose churn must not reach the platform.
  h.sources.sessions.set(list([session('a', { completed: true }), session('b', { completed: true })]))
  assert.deepEqual(h.calls, [1, 0])
})

test('readCount folds the three sources', () => {
  const sources = {
    sessions: source(list([session('a', { completed: true }), session('b')])),
    workspaces: source({ archivedSessionIds: [] }),
    pendingInteractions: source(pending({ b: 'question' })),
  }
  assert.equal(readCount(sources, DEFAULT_SETTINGS), 2)
})
