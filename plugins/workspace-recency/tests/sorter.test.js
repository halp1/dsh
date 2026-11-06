/**
 * The wrapper's live behavior against a stand-in for the host's workspace
 * model: it must reorder what consumers read, keep snapshot identity stable
 * enough for useSyncExternalStore, stay quiet on frames that change nothing,
 * and leave the source exactly as it found it on teardown.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installRecencySort } from '../src/client/sorter.ts'

/** Build a workspace row. */
function workspace(id, sessionIds = [], createdAt = '2024-01-01T00:00:00.000Z') {
  return { workspaceId: id, sessionIds, createdAt }
}

/**
 * A stand-in for ClientWorkspaceModel: prototype methods plus the private
 * `listeners` set, which is what the plugin's refresh/dispose path pokes.
 */
class FakeWorkspaceModel {
  constructor(items, archivedSessionIds = []) {
    this.listeners = new Set()
    this.snapshot = { items, archivedSessionIds, phase: 'ready' }
  }

  getSnapshot() {
    return this.snapshot
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Publish a new upstream snapshot, as a stream frame would. */
  publish(items, archivedSessionIds = this.snapshot.archivedSessionIds) {
    this.snapshot = { items, archivedSessionIds, phase: 'ready' }
    for (const listener of [...this.listeners]) listener()
  }
}

/** A minimal session-list source with a manual notification trigger. */
class FakeSessionList {
  constructor(byId, current) {
    this.listeners = new Set()
    this.state = { byId, current }
  }

  getSnapshot() {
    return this.state
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Replace session rows and notify, as a session stream frame would. */
  publish(byId, current = this.state.current) {
    this.state = { byId, current }
    for (const listener of [...this.listeners]) listener()
  }
}

/** Build a session index from id → updatedAt. */
function sessions(entries) {
  const byId = {}
  for (const [id, value] of Object.entries(entries)) {
    byId[id] = typeof value === 'number' ? { blank: false, updatedAt: value } : { blank: false, updatedAt: 0, ...value }
  }
  return byId
}

/** Settings reader with sorting on and no pinning. */
function enabled(overrides = {}) {
  return () => ({ enabled: true, pinCurrent: false, ...overrides })
}

/** Extract the ids a consumer would render. */
function ids(source) {
  return source.getSnapshot().items.map(item => item.workspaceId)
}

test('the patched snapshot is ordered by activity', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  installRecencySort({ workspaces, sessions: sessionList }, enabled())
  assert.deepEqual(ids(workspaces), ['b', 'a'])
})

test('disabled settings leave the host order untouched', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  installRecencySort({ workspaces, sessions: sessionList }, () => ({ enabled: false, pinCurrent: false }))
  assert.deepEqual(ids(workspaces), ['a', 'b'])
})

test('repeated reads return an identical reference', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  installRecencySort({ workspaces, sessions: sessionList }, enabled())
  assert.equal(
    workspaces.getSnapshot(),
    workspaces.getSnapshot(),
    'useSyncExternalStore loops forever if getSnapshot returns a fresh object',
  )
})

test('an unchanged order hands back the upstream snapshot itself', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 900, s2: 100 }))
  const upstream = workspaces.getSnapshot()
  installRecencySort({ workspaces, sessions: sessionList }, enabled())
  assert.equal(workspaces.getSnapshot(), upstream)
})

test('a session frame that reorders wakes consumers', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 900, s2: 100 }))
  installRecencySort({ workspaces, sessions: sessionList }, enabled())

  let woken = 0
  workspaces.subscribe(() => { woken += 1 })
  assert.deepEqual(ids(workspaces), ['a', 'b'])

  sessionList.publish(sessions({ s1: 900, s2: 1000 }))
  assert.equal(woken, 1)
  assert.deepEqual(ids(workspaces), ['b', 'a'])
})

test('a session frame that changes nothing visible stays quiet', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 900, s2: 100 }))
  installRecencySort({ workspaces, sessions: sessionList }, enabled())

  let woken = 0
  workspaces.subscribe(() => { woken += 1 })

  // Activity moves, but not enough to overtake: the order is unchanged.
  sessionList.publish(sessions({ s1: 900, s2: 200 }))
  assert.equal(woken, 0, 'typing in a chat must not re-render the sidebar tree')
})

test('upstream workspace frames still reach consumers', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  installRecencySort({ workspaces, sessions: sessionList }, enabled())

  let woken = 0
  workspaces.subscribe(() => { woken += 1 })

  workspaces.publish([workspace('a', ['s1']), workspace('b', ['s2'])])
  assert.equal(woken, 1)
  assert.deepEqual(ids(workspaces), ['b', 'a'])
})

test('archived sessions from the workspace snapshot are excluded', () => {
  // Timestamps sit after createdAt so the fallback cannot outrank them and
  // mask what this test is actually about.
  const t0 = Date.parse('2024-06-01T00:00:00.000Z')
  const workspaces = new FakeWorkspaceModel(
    [workspace('a', ['s1']), workspace('b', ['s2'])],
    ['s2'],
  )
  const sessionList = new FakeSessionList(sessions({ s1: t0, s2: t0 + 5000 }))
  installRecencySort({ workspaces, sessions: sessionList }, enabled())
  assert.deepEqual(ids(workspaces), ['a', 'b'], 'b\'s only activity is archived')
})

test('refresh republishes after a settings change', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  let settings = { enabled: false, pinCurrent: false }
  const sorter = installRecencySort({ workspaces, sessions: sessionList }, () => settings)

  let woken = 0
  workspaces.subscribe(() => { woken += 1 })
  assert.deepEqual(ids(workspaces), ['a', 'b'])

  settings = { enabled: true, pinCurrent: false }
  sorter.refresh()
  assert.equal(woken, 1)
  assert.deepEqual(ids(workspaces), ['b', 'a'])
})

test('the order accessor reports what the sidebar renders', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  const sorter = installRecencySort({ workspaces, sessions: sessionList }, enabled())
  assert.deepEqual(sorter.order, ['b', 'a'])
})

test('pinCurrent follows the selected session', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }), 's1')
  installRecencySort({ workspaces, sessions: sessionList }, enabled({ pinCurrent: true }))
  assert.deepEqual(ids(workspaces), ['a', 'b'])
})

test('a sidebar that rendered before install is woken to re-read', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  let woken = 0
  workspaces.subscribe(() => { woken += 1 })
  installRecencySort({ workspaces, sessions: sessionList }, enabled())
  assert.equal(woken, 1)
})

test('install stays quiet when the host order is already right', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 900, s2: 100 }))
  let woken = 0
  workspaces.subscribe(() => { woken += 1 })
  installRecencySort({ workspaces, sessions: sessionList }, enabled())
  assert.equal(woken, 0)
})

test('dispose restores the original prototype methods', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  const sorter = installRecencySort({ workspaces, sessions: sessionList }, enabled())
  assert.deepEqual(ids(workspaces), ['b', 'a'])

  sorter.dispose()
  assert.deepEqual(ids(workspaces), ['a', 'b'], 'the host manual order comes back')
  assert.ok(!Object.hasOwn(workspaces, 'getSnapshot'), 'no shadowing property may survive teardown')
  assert.ok(!Object.hasOwn(workspaces, 'subscribe'))
})

test('dispose unsubscribes the session bridge', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 900, s2: 100 }))
  const sorter = installRecencySort({ workspaces, sessions: sessionList }, enabled())
  workspaces.subscribe(() => {})
  sorter.dispose()
  assert.equal(sessionList.listeners.size, 0, 'a disposed plugin must not keep listening')
})

test('teardown wakes consumers so the restored order renders', () => {
  const workspaces = new FakeWorkspaceModel([workspace('a', ['s1']), workspace('b', ['s2'])])
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  const sorter = installRecencySort({ workspaces, sessions: sessionList }, enabled())

  let woken = 0
  workspaces.subscribe(() => { woken += 1 })
  sorter.dispose()
  assert.equal(woken, 1)
})

test('a source without a listeners set degrades instead of throwing', () => {
  const plain = {
    snapshot: { items: [workspace('a', ['s1']), workspace('b', ['s2'])], archivedSessionIds: [] },
    getSnapshot() { return this.snapshot },
    subscribe() { return () => {} },
  }
  const sessionList = new FakeSessionList(sessions({ s1: 100, s2: 900 }))
  const sorter = installRecencySort({ workspaces: plain, sessions: sessionList }, enabled())
  assert.deepEqual(ids(plain), ['b', 'a'])
  assert.doesNotThrow(() => { sorter.refresh() })
  assert.doesNotThrow(() => { sorter.dispose() })
})
