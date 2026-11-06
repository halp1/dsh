/**
 * Ordering rules: the projection from host state to workspace render order.
 *
 * These tests encode the contract "the group you worked in most recently sits
 * on top", including the exclusions that keep a workspace from floating up for
 * something the user never did: blank placeholder rows and archived sessions.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sameOrder,
  sortWorkspaces,
  workspaceActivityAt,
  workspaceOfSession,
} from '../src/client/activity.ts'

/** Build a workspace row with the fields the ordering reads. */
function workspace(id, sessionIds = [], createdAt = '2024-01-01T00:00:00.000Z') {
  return { workspaceId: id, sessionIds, createdAt }
}

/** Build a session index from id → updatedAt (or id → overrides). */
function sessions(entries) {
  const byId = {}
  for (const [id, value] of Object.entries(entries)) {
    byId[id] = typeof value === 'number'
      ? { blank: false, updatedAt: value }
      : { blank: false, updatedAt: 0, ...value }
  }
  return byId
}

/** The common context shape, with an empty archive set by default. */
function context(sessionIndex, archived = []) {
  return { sessions: sessionIndex, archived: new Set(archived) }
}

/** Extract ids, which is what every ordering assertion is really about. */
function ids(items) {
  return items.map(item => item.workspaceId)
}

test('activity is the newest session update in the workspace', () => {
  const ws = workspace('a', ['s1', 's2', 's3'])
  const at = workspaceActivityAt(ws, context(sessions({ s1: 100, s2: 900, s3: 400 })))
  assert.equal(at, 900)
})

test('blank sessions do not count as activity', () => {
  const ws = workspace('a', ['s1', 's2'])
  const at = workspaceActivityAt(ws, context(sessions({
    s1: 100,
    s2: { updatedAt: 999, blank: true },
  })))
  assert.equal(at, 100, 'a New Session placeholder must not float the workspace up')
})

test('archived sessions do not count as activity', () => {
  const ws = workspace('a', ['s1', 's2'])
  const at = workspaceActivityAt(ws, context(sessions({ s1: 100, s2: 999 }), ['s2']))
  assert.equal(at, 100, 'an archived row has no sidebar presence, so no influence')
})

test('a workspace with no usable session falls back to createdAt', () => {
  const ws = workspace('a', [], '2024-05-05T00:00:00.000Z')
  const at = workspaceActivityAt(ws, context(sessions({})))
  assert.equal(at, Date.parse('2024-05-05T00:00:00.000Z'))
})

test('a workspace whose sessions are all blank falls back to createdAt', () => {
  const ws = workspace('a', ['s1'], '2024-05-05T00:00:00.000Z')
  const at = workspaceActivityAt(ws, context(sessions({ s1: { updatedAt: 999, blank: true } })))
  assert.equal(at, Date.parse('2024-05-05T00:00:00.000Z'))
})

test('a membership entry with no session row is skipped, not crashed on', () => {
  const ws = workspace('a', ['ghost', 's1'])
  const at = workspaceActivityAt(ws, context(sessions({ s1: 50 })))
  assert.equal(at, 50)
})

test('an unparseable createdAt degrades instead of producing NaN', () => {
  const ws = workspace('a', [], 'not-a-date')
  const at = workspaceActivityAt(ws, context(sessions({})))
  assert.equal(at, Number.NEGATIVE_INFINITY)
  assert.ok(!Number.isNaN(at))
})

test('workspaces sort newest-active first', () => {
  const items = [
    workspace('old', ['s1']),
    workspace('new', ['s2']),
    workspace('mid', ['s3']),
  ]
  const sorted = sortWorkspaces(items, context(sessions({ s1: 100, s2: 900, s3: 500 })))
  assert.deepEqual(ids(sorted), ['new', 'mid', 'old'])
})

test('sorting does not mutate the input array', () => {
  const items = [workspace('a', ['s1']), workspace('b', ['s2'])]
  const before = ids(items)
  sortWorkspaces(items, context(sessions({ s1: 1, s2: 2 })))
  assert.deepEqual(ids(items), before)
})

test('ties keep the host manual order (stable sort)', () => {
  const items = [workspace('first', ['s1']), workspace('second', ['s2'])]
  const sorted = sortWorkspaces(items, context(sessions({ s1: 500, s2: 500 })))
  assert.deepEqual(ids(sorted), ['first', 'second'])
})

test('never-active workspaces keep manual order among themselves', () => {
  const items = [
    workspace('x', [], 'not-a-date'),
    workspace('y', [], 'not-a-date'),
    workspace('live', ['s1']),
  ]
  const sorted = sortWorkspaces(items, context(sessions({ s1: 10 })))
  assert.deepEqual(ids(sorted), ['live', 'x', 'y'])
})

test('a single workspace is returned untouched', () => {
  const items = [workspace('only', ['s1'])]
  assert.equal(sortWorkspaces(items, context(sessions({ s1: 5 }))), items)
})

test('pinCurrent keeps the open workspace on top', () => {
  const items = [workspace('a', ['s1']), workspace('b', ['s2'])]
  const options = {
    ...context(sessions({ s1: 100, s2: 900 })),
    currentWorkspaceId: 'a',
    pinCurrent: true,
  }
  assert.deepEqual(ids(sortWorkspaces(items, options)), ['a', 'b'])
})

test('pinCurrent preserves recency order among the rest', () => {
  const items = [workspace('a', ['s1']), workspace('b', ['s2']), workspace('c', ['s3'])]
  const options = {
    ...context(sessions({ s1: 100, s2: 900, s3: 500 })),
    currentWorkspaceId: 'a',
    pinCurrent: true,
  }
  assert.deepEqual(ids(sortWorkspaces(items, options)), ['a', 'b', 'c'])
})

test('pinCurrent is inert when the current session is ungrouped', () => {
  const items = [workspace('a', ['s1']), workspace('b', ['s2'])]
  const options = {
    ...context(sessions({ s1: 100, s2: 900 })),
    currentWorkspaceId: undefined,
    pinCurrent: true,
  }
  assert.deepEqual(ids(sortWorkspaces(items, options)), ['b', 'a'])
})

test('workspaceOfSession finds the accounting workspace', () => {
  const items = [workspace('a', ['s1']), workspace('b', ['s2'])]
  assert.equal(workspaceOfSession(items, 's2'), 'b')
  assert.equal(workspaceOfSession(items, 'stray'), undefined)
  assert.equal(workspaceOfSession(items, undefined), undefined)
})

test('sameOrder compares ids positionally', () => {
  assert.ok(sameOrder([workspace('a'), workspace('b')], [workspace('a'), workspace('b')]))
  assert.ok(!sameOrder([workspace('a'), workspace('b')], [workspace('b'), workspace('a')]))
  assert.ok(!sameOrder([workspace('a')], [workspace('a'), workspace('b')]))
})
