import test from 'node:test'
import assert from 'node:assert/strict'
import { MiniSessions } from '../src/client/session-controller.ts'
import { HostClient } from '../src/client/host-client.ts'
import { defaultState, normalizeState, validatePatch, validateShortcut } from '../shared/state.mjs'

const source = value => ({ getSnapshot: () => value, subscribe: () => () => {} })
function fixture() {
  const released = [], saved = [], creates = []
  const rows = { a: { id: 'a', blank: false, displayTitle: 'Existing chat' }, b: { id: 'b', blank: false, displayTitle: 'Other chat' }, fresh: { id: 'fresh', blank: true } }
  const sessions = { list: source({ ids: ['a','b'], byId: rows, phase: 'ready' }), refresh: async () => {}, retain: id => ({ sessionId: id, binding: { sessionId: id }, ready: Promise.resolve(), release: () => released.push(id) }), create: async options => { creates.push(options); return 'fresh' } }
  const workspaces = { list: source({ items: [{ workspaceId: 'ws', title: 'Project', path: '/project', sessionIds: ['a','b','fresh'] }], archivedSessionIds: [], phase: 'ready' }) }
  const host = { refresh: async () => {}, getSnapshot: () => ({ state: { ...defaultState(), lastSessionId: 'a', lastWorkspaceId: 'ws' } }), patch: async value => { saved.push(value) } }
  const controller = new MiniSessions(sessions, workspaces, { connectWorkspace: async () => 'fresh' }, host)
  return { controller, sessions, workspaces, released, saved, creates, host }
}
test('restores last session without navigating the normal GUI or creating a blank session', async () => {
  const f = fixture(); await f.controller.initialize()
  assert.equal(f.controller.getSnapshot().reference.sessionId, 'a')
  assert.equal(f.controller.getSnapshot().workspaceId, 'ws')
  assert.equal(f.creates.length, 0)
  assert.deepEqual(f.saved[0], { lastSessionId: 'a', lastWorkspaceId: 'ws' })
  f.controller.dispose(); assert.deepEqual(f.released, ['a'])
})
test('CmdN creates a distinct blank session in the mini workspace', async () => {
  const f = fixture(); await f.controller.initialize(); await f.controller.newChat()
  assert.deepEqual(f.creates, [{ workspaceId: 'ws' }]); assert.equal(f.controller.getSnapshot().reference.sessionId, 'fresh')
  await Promise.resolve(); assert.deepEqual(f.released, ['a']); f.controller.dispose()
})
test('uncategorized chat uses an unscoped session and CmdN stays uncategorized', async () => {
  const f = fixture(); await f.controller.initialize()
  assert.equal(await f.controller.newChat(null), true)
  assert.deepEqual(f.creates, [{}])
  assert.equal(f.controller.getSnapshot().workspaceId, null)
  assert.deepEqual(f.saved.at(-1), { lastSessionId: 'fresh', lastWorkspaceId: null })
  assert.equal(await f.controller.newChat(), true)
  assert.deepEqual(f.creates, [{}, {}])
  f.controller.dispose()
})
test('uncategorized history opens without adopting the previous workspace', async () => {
  const f = fixture(); await f.controller.initialize()
  assert.equal(await f.controller.open('ungrouped'), true)
  assert.equal(f.controller.getSnapshot().workspaceId, null)
  assert.equal(await f.controller.newChat(), true)
  assert.deepEqual(f.creates, [{}])
  f.controller.dispose()
})
test('failed history opening preserves previous session and releases failed reference', async () => {
  const f = fixture(); await f.controller.initialize()
  f.sessions.retain = id => ({ sessionId: id, ready: Promise.reject(new Error('History unavailable')), release: () => f.released.push(id) })
  assert.equal(await f.controller.open('b'), false)
  assert.equal(f.controller.getSnapshot().reference.sessionId, 'a'); assert.equal(f.controller.getSnapshot().error, 'History unavailable')
  assert.deepEqual(f.released, ['b']); f.controller.dispose()
})
test('superseded open cannot replace newer selection and releases stale reference', async () => {
  const f = fixture(); await f.controller.initialize()
  let settle; f.sessions.retain = id => ({ sessionId: id, ready: id === 'b' ? new Promise(resolve => { settle = resolve }) : Promise.resolve(), release: () => f.released.push(id) })
  const first = f.controller.open('b'); await f.controller.open('fresh'); settle(); assert.equal(await first, false)
  assert.equal(f.controller.getSnapshot().reference.sessionId, 'fresh'); assert.ok(f.released.includes('b')); f.controller.dispose()
})
test('disposal during open releases arriving reference and does not save selection', async () => {
  const f = fixture(); let settle
  f.sessions.retain = id => ({ sessionId: id, ready: new Promise(resolve => { settle = resolve }), release: () => f.released.push(id) })
  const open = f.controller.open('b'); f.controller.dispose(); settle(); assert.equal(await open, false)
  assert.deepEqual(f.released, ['b']); assert.equal(f.saved.length, 0)
})
test('deleted or archived remembered session falls back to reusable blank without normal navigation', async () => {
  const f = fixture(); f.workspaces.list = source({ items: [{ workspaceId: 'ws', sessionIds: ['a'] }], archivedSessionIds: ['a'], phase: 'ready' })
  await f.controller.initialize(); assert.equal(f.controller.getSnapshot().reference.sessionId, 'fresh'); assert.equal(f.creates.length, 0); f.controller.dispose()
})
test('host settings mutations retry revision conflicts using the current revision', async () => {
  const bodies = []; let revision = 4, requests = 0
  const fetcher = async (_url, options) => { if (options?.body) bodies.push(JSON.parse(options.body)); requests++; const status = requests === 2 ? 409 : 200; revision++; return new Response(JSON.stringify({ state: { ...defaultState(), revision }, runtime: { status: 'ready', visible: false, expanded: false, shortcutRegistered: true } }), { status }) }
  const client = new HostClient(fetcher); await client.refresh(); await client.patch({ lastSessionId: 'a' })
  assert.deepEqual(bodies.map(b => b.baseRevision), [5,6]); assert.equal(client.getSnapshot().state.revision, 7)
})
test('shortcut conflict surfaces error and keeps server-confirmed old shortcut', async () => {
  const client = new HostClient(async (_url, options) => new Response(JSON.stringify({ state: defaultState(), runtime: { status: 'ready', visible: false, expanded: false, shortcutRegistered: true, ...(options?.method === 'POST' ? { error: 'Shortcut is occupied.' } : {}) } }), { status: options?.method === 'POST' ? 422 : 200 }))
  await client.refresh(); await assert.rejects(client.patch({ shortcut: 'Command+Alt+Space' }), /occupied/)
  assert.equal(client.getSnapshot().state.shortcut, 'Command+Shift+Space')
})
test('startup waits for the independent workspace baseline before restoring and remembering context', async () => {
  const f = fixture(); let value = { items: [], archivedSessionIds: [], phase: 'pending' }; const listeners = new Set()
  f.workspaces.list = { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  const init = f.controller.initialize(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.saved.length, 0); assert.equal(f.controller.getSnapshot().reference, null)
  value = { items: [{ workspaceId: 'ws', sessionIds: ['a'] }], archivedSessionIds: [], phase: 'ready' }; listeners.forEach(fn => fn())
  await init; assert.equal(f.controller.getSnapshot().workspaceId, 'ws'); assert.equal(f.saved[0].lastWorkspaceId, 'ws')
  assert.equal(await f.controller.newChat(), true); assert.equal(listeners.size, 0); f.controller.dispose()
})
test('disposal cancels pending catalog readiness and cannot restore an archived session early', async () => {
  const f = fixture(); const listeners = new Set()
  f.workspaces.list = { getSnapshot: () => ({ items: [], archivedSessionIds: [], phase: 'pending' }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
  const init = f.controller.initialize(); await new Promise(resolve => setImmediate(resolve)); assert.equal(listeners.size, 1)
  f.controller.dispose(); await init; assert.equal(listeners.size, 0); assert.equal(f.saved.length, 0); assert.equal(f.creates.length, 0)
})
test('disposed selection never creates or retains another session', async () => {
  const f = fixture(); f.controller.dispose()
  assert.equal(await f.controller.newChat('ws'), false); assert.equal(await f.controller.open('a'), false)
  assert.equal(f.creates.length, 0); assert.equal(f.saved.length, 0)
})
test('older polling responses cannot regress confirmed persisted state', async () => {
  let call = 0
  const client = new HostClient(async () => new Response(JSON.stringify({ state: { ...defaultState(), revision: ++call === 1 ? 5 : 2, shortcut: call === 1 ? 'Command+Alt+Space' : 'Command+Shift+Space' }, runtime: { status: 'ready', visible: false, expanded: false, shortcutRegistered: true } })))
  await client.refresh(); await client.refresh()
  assert.equal(client.getSnapshot().state.revision, 5); assert.equal(client.getSnapshot().state.shortcut, 'Command+Alt+Space')
})
test('shared state rejects unknown mutations and standard local shortcuts', () => {
  assert.throws(() => validatePatch({ electronPath: '/evil' }), /Unknown/)
  assert.throws(() => validateShortcut('Command+N'), /local/)
  assert.throws(() => validateShortcut('Space'), /modifier/)
  assert.equal(normalizeState({ bounds: { x: NaN, y: 0, width: 600, height: 600 }, shortcut: 'bad' }).bounds, null)
  assert.deepEqual(validatePatch({ lastSessionId: null, enabled: false }), { lastSessionId: null, enabled: false })
})
