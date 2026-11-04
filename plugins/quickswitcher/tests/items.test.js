import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSections, RECENT_CAP, ago, displayPath } from '../src/client/items.ts'

const row = (id, title, updatedAt, extra = {}) => ({
  id, displayTitle: title, blank: false, running: false, updatedAt, retainedBy: {}, ...extra,
})

function fixture() {
  const rows = [
    row('s1', 'Fix login bug', 100),
    row('s2', 'Refactor parser', 300),
    row('s3', 'Release notes', 200),
    row('blank', 'New session', 999, { blank: true }),
    row('sub', 'Subagent work', 998, { origin: 'subagent' }),
    row('arch', 'Archived login', 997),
    row('loose', 'Stray thoughts', 50, { cwd: '/Users/me/scratch' }),
  ]
  return {
    sessions: { ids: rows.map(r => r.id), byId: Object.fromEntries(rows.map(r => [r.id, r])) },
    workspaces: {
      items: [
        { workspaceId: 'w1', title: 'webapp', path: '/Users/me/code/webapp', sessionIds: ['s1', 's2', 'blank', 'arch'] },
        { workspaceId: 'w2', title: 'docs', path: '/Users/me/code/docs', sessionIds: ['s3'] },
      ],
      archivedSessionIds: ['arch'],
    },
  }
}

const ids = section => section.items.map(item => item.sessionId ?? item.workspaceId)

test('empty query: recently opened first, then by last change, excluding non-switchable rows', () => {
  const sections = buildSections({ ...fixture(), query: '  ', recent: ['s1', 'gone', 's3'], currentId: 's3' })
  assert.deepEqual(sections.map(s => s.key), ['recent', 'workspaces'])
  // s3 is current, blank/sub/arch never show, unknown ids in recent are ignored.
  assert.deepEqual(ids(sections[0]), ['s1', 's2', 'loose'])
  assert.deepEqual(ids(sections[1]), ['w1', 'w2'])
  // Ungrouped sessions use their cwd basename as context.
  assert.equal(sections[0].items[2].context, 'scratch')

  const many = fixture()
  for (let i = 0; i < 20; i += 1) {
    const r = row(`x${i}`, `extra ${i}`, i)
    many.sessions.ids.push(r.id)
    many.sessions.byId[r.id] = r
  }
  assert.equal(buildSections({ ...many, query: '', recent: [] })[0].items.length, RECENT_CAP)
})

test('query: every token must match title or workspace, title matches outrank workspace matches', () => {
  const base = fixture()
  // "login" hits s1 by title only: the archived "Archived login" stays out.
  assert.deepEqual(ids(buildSections({ ...base, query: 'login', recent: [] })[0]), ['s1'])
  // "web" matches s1 and s2 through their workspace, and the webapp workspace itself.
  const web = buildSections({ ...base, query: 'web', recent: [] })
  assert.deepEqual(web.map(s => s.key), ['sessions', 'workspaces'])
  assert.deepEqual(ids(web[1]), ['w1'])
  // Equal scores fall back to recency of opening, then last change.
  assert.deepEqual(ids(web[0]), ['s2', 's1'])
  assert.deepEqual(ids(buildSections({ ...base, query: 'web', recent: ['s1'] })[0]), ['s1', 's2'])
  // Tokens AND together: "web parser" keeps only s2, with ranges on both fields.
  const both = buildSections({ ...base, query: 'web parser', recent: [] })[0]
  assert.deepEqual(ids(both), ['s2'])
  assert.deepEqual(both.items[0].titleRanges, [[9, 15]])
  assert.deepEqual(both.items[0].contextRanges, [[0, 3]])
  // A workspace-only match still lists the session.
  const notes = buildSections({ ...base, query: 'doc', recent: [] })
  assert.deepEqual(ids(notes[0]), ['s3'])
  assert.deepEqual(buildSections({ ...base, query: 'qqq', recent: [] }), [])
})

test('messages: only switchable sessions not already listed, in host order', () => {
  const sections = buildSections({
    ...fixture(),
    query: 'login',
    recent: [],
    currentId: 's2',
    contentHits: [
      { sessionId: 's1', snippet: 'already a title match' },
      { sessionId: 'arch', snippet: 'archived' },
      { sessionId: 's2', snippet: 'current' },
      { sessionId: 'loose', snippet: 'login flow notes' },
      { sessionId: 's3', snippet: 'release login' },
      { sessionId: 'loose', snippet: 'duplicate' },
      { sessionId: 'unknown', snippet: 'missing row' },
    ],
  })
  const messages = sections.find(s => s.key === 'messages')
  assert.deepEqual(ids(messages), ['loose', 's3'])
  assert.equal(messages.items[0].snippet, 'login flow notes')
})

test('ago and displayPath', () => {
  const now = 10 * 365 * 86_400_000
  assert.deepEqual(
    [0, 30_000, 5 * 60_000, 3 * 3_600_000, 2 * 86_400_000, 30 * 86_400_000, 400 * 86_400_000].map(d => ago(now - d, now)),
    ['now', 'now', '5m', '3h', '2d', '4w', '1y'],
  )
  assert.equal(displayPath('/Users/me/code/x'), '~/code/x')
  assert.equal(displayPath('/home/me'), '~')
  assert.equal(displayPath('/opt/x'), '/opt/x')
})
