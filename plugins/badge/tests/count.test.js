/**
 * Counting rules: the projection from host state to one badge number.
 *
 * These tests encode the contract "whatever puts a circle on a sidebar row puts
 * a unit on the app icon", including the exclusions that keep the badge from
 * lying: subagent rows, archived rows, unselected blank rows, and running work.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COUNT_OPTIONS,
  countUnread,
  isAttentionKind,
  mainSessionId,
  sessionCounts,
  sessionVisible,
} from '../src/client/count.ts'

/** Build a session summary with the fields the counter reads. */
function session(id, overrides = {}) {
  return { id, displayTitle: id, blank: false, running: false, updatedAt: 0, retainedBy: {}, ...overrides }
}

/** Build a SessionListState from summaries, preserving order. */
function list(summaries, current) {
  // The selection is expressed the way the host does: a main-view retain.
  const byId = {}
  for (const s of summaries) byId[s.id] = s.id === current ? { ...s, retainedBy: { mainView: 1 } } : s
  return {
    ids: summaries.map(s => s.id),
    byId,
  }
}

/**
 * Build the ui-session status map. `interactions` maps id → pending kind;
 * `unread` lists ids carrying the completion reminder.
 */
function statuses({ interactions = {}, unread = [] } = {}) {
  const map = new Map()
  const entry = (id) => {
    if (!map.has(id)) map.set(id, { running: undefined, pendingInteraction: undefined, completionUnread: false })
    return map.get(id)
  }
  for (const [id, kind] of Object.entries(interactions)) entry(id).pendingInteraction = { key: `${id}-k`, kind, sessionId: id }
  for (const id of unread) entry(id).completionUnread = true
  return map
}

/** Shorthand for a full count input. */
function input(summaries, { current, archived = [], interactions = {}, unread = [] } = {}) {
  return {
    list: list(summaries, current),
    archivedSessionIds: archived,
    statuses: statuses({ interactions, unread }),
  }
}

test('counts nothing when every session is idle', () => {
  assert.equal(countUnread(input([session('a'), session('b')])), 0)
})

test('counts a finished-unread session', () => {
  assert.equal(countUnread(input([session('a'), session('b')], { unread: ['a'] })), 1)
})

test('counts each attention kind the sidebar shows as a warning dot', () => {
  for (const kind of ['approval', 'plan-review', 'question']) {
    assert.equal(countUnread(input([session('a')], { interactions: { a: kind } })), 1, kind)
  }
})

test('ignores an unrecognized pending-interaction kind', () => {
  // The host `kind` field is an open string; an unknown domain gets no sidebar
  // dot, so it must get no badge unit either.
  assert.equal(countUnread(input([session('a')], { interactions: { a: 'telemetry-ping' } })), 0)
})

test('does not count a running session by default', () => {
  assert.equal(countUnread(input([session('a', { running: true })])), 0)
})

test('counts a running session when countRunning is on', () => {
  const state = input([session('a', { running: true })])
  assert.equal(countUnread(state, { ...DEFAULT_COUNT_OPTIONS, countRunning: true }), 1)
})

test('a status running fact overrides the summary once established', () => {
  // ui-workspace reads `status.running ?? summary.running`; a stopped status
  // entry must win over a stale running summary.
  const state = input([session('a', { running: true })])
  state.statuses.set('a', { running: false, pendingInteraction: undefined, completionUnread: false })
  assert.equal(countUnread(state, { ...DEFAULT_COUNT_OPTIONS, countRunning: true }), 0)
})

test('counts a session once even when it both blocks and completed', () => {
  // One row shows one dot, so one row contributes one unit.
  const state = input([session('a')], { interactions: { a: 'approval' }, unread: ['a'] })
  assert.equal(countUnread(state), 1)
})

test('attention still counts for the currently open session', () => {
  // A question is outstanding until answered, even while you look at it; the
  // host removes it from the map the moment it is answered.
  const state = input([session('a')], { current: 'a', interactions: { a: 'question' } })
  assert.equal(countUnread(state), 1)
})

test('excludes archived sessions', () => {
  const state = input([session('a')], { archived: ['a'], unread: ['a'] })
  assert.equal(countUnread(state), 0)
})

test('excludes subagent-origin sessions, which have no row of their own', () => {
  const state = input([session('a', { origin: 'subagent' })], { unread: ['a'] })
  assert.equal(countUnread(state), 0)
})

test('excludes a blank session unless it is the selected provisional row', () => {
  const blank = [session('a', { blank: true })]
  assert.equal(countUnread(input(blank, { unread: ['a'] })), 0)
  assert.equal(countUnread(input(blank, { current: 'a', unread: ['a'] })), 1)
})

test('sums across many sessions', () => {
  const state = input([
    session('a'),
    session('b'),
    session('c'),
    session('d', { running: true }),
  ], { interactions: { b: 'approval' }, unread: ['a', 'c'] })
  assert.equal(countUnread(state), 3)
})

test('honours the disable switches independently', () => {
  const state = input([session('a')], { interactions: { b: 'approval' }, unread: ['a'] })
  assert.equal(countUnread(state, { ...DEFAULT_COUNT_OPTIONS, countCompleted: false }), 0)
})

test('skips ids missing from byId', () => {
  const state = input([session('a')], { unread: ['a'] })
  state.list.ids.push('ghost')
  assert.equal(countUnread(state), 1)
})

test('sessionVisible mirrors the sidebar row rules', () => {
  const archived = new Set(['x'])
  assert.equal(sessionVisible(session('a'), undefined, archived), true)
  assert.equal(sessionVisible(session('x'), undefined, archived), false)
  assert.equal(sessionVisible(session('a', { origin: 'subagent' }), undefined, archived), false)
  assert.equal(sessionVisible(session('a', { blank: true }), undefined, archived), false)
  assert.equal(sessionVisible(session('a', { blank: true }), 'a', archived), true)
})

test('isAttentionKind accepts exactly the warning kinds', () => {
  assert.equal(isAttentionKind('approval'), true)
  assert.equal(isAttentionKind('plan-review'), true)
  assert.equal(isAttentionKind('question'), true)
  assert.equal(isAttentionKind(undefined), false)
  assert.equal(isAttentionKind('done'), false)
})

test('sessionCounts gives pending interaction precedence over completion', () => {
  const options = { countCompleted: false, countAttention: true, countRunning: false }
  const pendingApproval = { key: 'k', kind: 'approval', sessionId: 'a' }
  assert.equal(sessionCounts(session('a'), { completionUnread: true, pendingInteraction: pendingApproval }, options), true)
  assert.equal(sessionCounts(session('a'), { completionUnread: true }, options), false)
})

test('mainSessionId finds the session the main view retains', () => {
  assert.equal(mainSessionId(list([session('a'), session('b')], 'b')), 'b')
  assert.equal(mainSessionId(list([session('a')])), undefined)
})
