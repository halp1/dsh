/**
 * Ungrouped: its membership and the folder's rank among the workspaces.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mainSessionId,
  placeUngrouped,
  sessionsActivityAt,
  ungroupedSessionIds,
} from '../src/client/activity.ts'
import { computePlacement, folderStylesheet, installFolderPlacement } from '../src/client/folder.ts'
import { DEFAULT_SETTINGS } from '../src/client/settings.ts'

const T = Date.parse('2026-01-10T12:00:00.000Z')
const HOUR = 3_600_000

function workspace(id, sessionIds = [], createdAt = '2025-01-01T00:00:00.000Z') {
  return { workspaceId: id, sessionIds, createdAt }
}

/** A session row; numbers are shorthand for updatedAt. */
function row(value) {
  return typeof value === 'number' ? { blank: false, updatedAt: value } : { blank: false, updatedAt: 0, ...value }
}

/** A DSH 0.2 session list (no `current`; the open one is retained by mainView). */
function list(entries, open) {
  const byId = {}
  for (const [id, value] of Object.entries(entries)) {
    byId[id] = { ...row(value), retainedBy: id === open ? { mainView: 1 } : {} }
  }
  return { ids: Object.keys(entries), byId }
}

class Source {
  constructor(state) { this.state = state; this.listeners = new Set() }
  getSnapshot() { return this.state }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  publish(state) { this.state = state; for (const fn of [...this.listeners]) fn() }
}

const settings = (overrides = {}) => () => ({ ...DEFAULT_SETTINGS, ...overrides })
const workspaceState = (items, archivedSessionIds = []) => ({ items, archivedSessionIds })

// ---- session identity on DSH 0.2 -------------------------------------------

test('the open session comes from retainedBy.mainView on DSH 0.2', () => {
  assert.equal(mainSessionId(list({ a: T, b: T }, 'b')), 'b')
})

test('the open session falls back to list.current on DSH 0.1', () => {
  assert.equal(mainSessionId({ ids: ['a'], byId: { a: row(T) }, current: 'a' }), 'a')
})

test('subagent rows do not count as activity', () => {
  const sessions = list({ a: T, child: { updatedAt: T + HOUR, origin: 'subagent' } }).byId
  assert.equal(sessionsActivityAt(['a', 'child'], { sessions, archived: new Set() }), T)
})

// ---- Ungrouped membership ------------------------------------------------

test('ungrouped members are the sessions no workspace accounts for', () => {
  const items = [workspace('w', ['s1'])]
  assert.deepEqual(ungroupedSessionIds(items, list({ s1: T, u1: T, u2: T })), ['u1', 'u2'])
})

// ---- the Ungrouped folder's rank -------------------------------------------

const context = (entries, ungroupedIds, extra = {}) => ({
  sessions: list(entries).byId,
  archived: new Set(),
  ungroupedIds,
  ...extra,
})

test('Ungrouped ranks between workspaces by its newest session', () => {
  const items = [workspace('fresh', ['f']), workspace('stale', ['s'])]
  const placement = placeUngrouped(items, context({ f: T, s: T - 2 * HOUR, u: T - HOUR }, ['u']))
  assert.deepEqual(placement.before, ['fresh'])
  assert.equal(placement.last, false)
})

test('Ungrouped goes first when it holds the newest session', () => {
  const items = [workspace('a', ['a1'])]
  const placement = placeUngrouped(items, context({ a1: T - HOUR, u: T }, ['u']))
  assert.deepEqual(placement.before, [])
})

test('ties go to the workspace', () => {
  const items = [workspace('a', ['a1'])]
  const placement = placeUngrouped(items, context({ a1: T, u: T }, ['u']))
  assert.equal(placement.last, true)
})

test('an Ungrouped folder with only blank/archived rows stays last', () => {
  const items = [workspace('a', ['a1'])]
  const sessions = list({ a1: T - 99 * HOUR, b: { blank: true, updatedAt: T }, z: T }).byId
  const placement = placeUngrouped(items, { sessions, archived: new Set(['z']), ungroupedIds: ['b', 'z'] })
  assert.equal(placement.last, true)
})

test('pinCurrent keeps the open workspace above Ungrouped', () => {
  const items = [workspace('a', ['a1'])]
  const placement = placeUngrouped(items, context({ a1: T - HOUR, u: T }, ['u'], { pinCurrent: true, currentWorkspaceId: 'a' }))
  assert.deepEqual(placement.before, ['a'])
})

test('pinCurrent lifts Ungrouped to the top when the open session is in it', () => {
  const items = [workspace('a', ['a1'])]
  const placement = placeUngrouped(items, context({ a1: T, u: T - HOUR }, ['u'], { pinCurrent: true, currentInUngrouped: true }))
  assert.deepEqual(placement.before, [])
})

test('computePlacement wires DSH 0.2 state together', () => {
  const workspaces = new Source(workspaceState([workspace('a', ['a1']), workspace('b', ['b1'])]))
  const sessions = new Source(list({ a1: T, b1: T - 2 * HOUR, u: T - HOUR }))
  const placement = computePlacement({ workspaces, sessions }, DEFAULT_SETTINGS)
  assert.deepEqual(placement.before, ['a'])
})

test('no stylesheet when Ungrouped already belongs last', () => {
  assert.equal(folderStylesheet({ activityAt: 0, before: ['a'], last: true }), '')
})

test('the stylesheet orders the outranking sections first and Ungrouped next', () => {
  const css = folderStylesheet({ activityAt: T, before: ['a', 'b"x'], last: false })
  assert.match(css, /display: flex/)
  assert.match(css, /order: 1/)
  assert.match(css, /\[data-row-key="workspace:a"\]/)
  assert.match(css, /\[data-row-key="workspace:b\\"x"\]/, 'ids are quoted safely')
  assert.match(css, /order: 0/)
})

test('the stylesheet with Ungrouped first has no order-0 rule', () => {
  const css = folderStylesheet({ activityAt: T, before: [], last: false })
  assert.doesNotMatch(css, /order: 0/)
})

/** A minimal document for the placer. */
function fakeDocument() {
  const appended = []
  return {
    appended,
    head: { appendChild: node => { appended.push(node) } },
    createElement: () => {
      const node = { textContent: '', dataset: {}, removed: false, remove() { node.removed = true } }
      return node
    },
  }
}

test('the placer injects, updates, and removes one stylesheet', () => {
  const doc = fakeDocument()
  const workspaces = new Source(workspaceState([workspace('a', ['a1'])]))
  const sessions = new Source(list({ a1: T, u: T - HOUR }))
  const placer = installFolderPlacement({ workspaces, sessions }, settings(), doc)
  assert.equal(doc.appended.length, 0, 'Ungrouped already last: nothing injected')

  sessions.publish(list({ a1: T, u: T + HOUR }))
  assert.equal(doc.appended.length, 1)
  assert.match(doc.appended[0].textContent, /order: 1/)

  sessions.publish(list({ a1: T, u: T - HOUR }))
  assert.equal(doc.appended[0].textContent, '', 'back to last: rules cleared')

  placer.dispose()
  assert.equal(doc.appended[0].removed, true)
  assert.equal(sessions.listeners.size, 0)
})

test('the placer does nothing when the folder setting is off', () => {
  const doc = fakeDocument()
  const workspaces = new Source(workspaceState([workspace('a', ['a1'])]))
  const sessions = new Source(list({ a1: T - HOUR, u: T }))
  installFolderPlacement({ workspaces, sessions }, settings({ moveUngroupedFolder: false }), doc)
  assert.equal(doc.appended.length, 0)
})
