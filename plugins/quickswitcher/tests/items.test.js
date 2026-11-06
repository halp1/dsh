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

test('query: workspaces lead, every token must match title or workspace', () => {
  const base = fixture()
  const query = (q, recent = []) => buildSections({ ...base, query: q, recent })
  const section = (sections, key) => sections.find(s => s.key === key)
  // "login" hits s1 by title only: the archived "Archived login" stays out.
  assert.deepEqual(ids(section(query('login'), 'sessions')), ['s1'])
  // "web" matches the webapp workspace, listed first, then s1 and s2 through it.
  const web = query('web')
  assert.deepEqual(web.map(s => s.key), ['workspaces', 'sessions'])
  assert.deepEqual(ids(section(web, 'workspaces')), ['w1'])
  // Equal scores fall back to recency of opening, then last change.
  assert.deepEqual(ids(section(web, 'sessions')), ['s2', 's1'])
  assert.deepEqual(ids(section(query('web', ['s1']), 'sessions')), ['s1', 's2'])
  // Tokens AND together: "web parser" keeps only s2, with ranges on both fields.
  const both = query('web parser')
  assert.equal(section(both, 'workspaces'), undefined)
  assert.deepEqual(ids(section(both, 'sessions')), ['s2'])
  assert.deepEqual(section(both, 'sessions').items[0].titleRanges, [[9, 15]])
  assert.deepEqual(section(both, 'sessions').items[0].contextRanges, [[0, 3]])
  // A workspace-only match still lists the session.
  assert.deepEqual(ids(section(query('doc'), 'sessions')), ['s3'])
  assert.deepEqual(query('qqq'), [])
})

test('workspaces match only an unbroken piece of their name, never the path or scattered letters', () => {
  const base = fixture()
  base.workspaces.items.push(
    { workspaceId: 'cs', title: 'cs173', path: '/Users/me/school/cs173', sessionIds: [] },
    { workspaceId: 'pics', title: 'Pics', path: '/Users/me/pics', sessionIds: [] },
    { workspaceId: 'scatter', title: 'claude-sonnet', path: '/Users/me/cs/claude', sessionIds: [] },
  )
  const workspaces = q => buildSections({ ...base, query: q, recent: [] }).find(s => s.key === 'workspaces')
  // Word-start first, then mid-word ("docs", "Pics") in sidebar order; scattered c..s and path-only hits never show.
  assert.deepEqual(ids(workspaces('cs')), ['cs', 'w2', 'pics'])
  assert.deepEqual(workspaces('CS1').items[0].titleRanges, [[0, 3]])
  // "code" is only in paths.
  assert.equal(workspaces('code'), undefined)
  // Every token must be in the name.
  assert.deepEqual(ids(workspaces('cs 173')), ['cs'])
  assert.equal(workspaces('cs web'), undefined)
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
