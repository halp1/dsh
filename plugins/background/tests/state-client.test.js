/**
 * The browser state client against a scripted fake transport.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStateClient } from '../src/client/state-client.ts'
import { emptyState } from '../src/shared/state.ts'

const entry = { id: 'a1', kind: 'url', source: 'https://x.test/a.png', inRotation: true }
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function transport(script) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.parse(init.body) })
    const next = script.shift()
    if (next instanceof Error) throw next
    return next
  }
  return { fetch, calls }
}

test('refresh loads host state and info', async () => {
  const state = { ...emptyState(), revision: 4, entries: [entry] }
  const t = transport([reply(200, { state, folders: {}, files: {} })])
  const client = createStateClient(t.fetch)
  await client.refresh()
  assert.equal(client.getSnapshot().status, 'ready')
  assert.equal(client.getSnapshot().state.revision, 4)
  assert.equal(t.calls[0].url, 'api/dsh-background.state')
})

test('send applies optimistically, posts the base revision, and adopts the reply', async () => {
  const base = { ...emptyState(), revision: 1, entries: [entry] }
  const t = transport([reply(200, { state: base }), reply(200, { state: { ...base, revision: 2, activeId: 'a1' } })])
  const client = createStateClient(t.fetch)
  await client.refresh()
  const seen = []
  client.subscribe(() => seen.push(client.getSnapshot().state.activeId))
  const pending = client.send({ type: 'set-active', id: 'a1' })
  assert.equal(client.getSnapshot().state.activeId, 'a1', 'optimistic')
  assert.deepEqual(await pending, { ok: true })
  assert.deepEqual(t.calls[1].body, { baseRevision: 1, op: { type: 'set-active', id: 'a1' } })
  assert.equal(client.getSnapshot().state.revision, 2)
  assert.ok(seen.length >= 2)
})

test('a 409 adopts the fresh state and replays the op once', async () => {
  const base = { ...emptyState(), revision: 1, entries: [entry] }
  const fresh = { ...base, revision: 5, entries: [entry, { ...entry, id: 'b2' }] }
  const t = transport([
    reply(200, { state: base }),
    reply(409, { error: 'stale', state: fresh }),
    reply(200, { state: { ...fresh, revision: 6, activeId: 'b2' } }),
  ])
  const client = createStateClient(t.fetch)
  await client.refresh()
  assert.deepEqual(await client.send({ type: 'set-active', id: 'b2' }), { ok: true })
  assert.equal(t.calls[2].body.baseRevision, 5)
  assert.equal(client.getSnapshot().state.entries.length, 2, 'the other device\'s entry survived')
  assert.equal(client.getSnapshot().state.activeId, 'b2')
})

test('an add rejection surfaces the host message and changes nothing', async () => {
  const t = transport([reply(200, { state: emptyState() }), reply(400, { error: '/x.png does not exist' })])
  const client = createStateClient(t.fetch)
  await client.refresh()
  assert.deepEqual(await client.send({ type: 'add', source: '/x.png' }), { ok: false, error: '/x.png does not exist' })
  assert.deepEqual(client.getSnapshot().state.entries, [])
})

test('a network failure reverts the optimistic edit and keeps the last state', async () => {
  const base = { ...emptyState(), revision: 1, entries: [entry] }
  const t = transport([reply(200, { state: base }), new Error('offline'), new Error('offline')])
  const client = createStateClient(t.fetch)
  await client.refresh()
  const result = await client.send({ type: 'set-active', id: 'a1' })
  assert.equal(result.ok, false)
  assert.equal(client.getSnapshot().state.activeId, null)
  await client.refresh()
  assert.equal(client.getSnapshot().status, 'ready')
  assert.equal(client.getSnapshot().state.entries.length, 1)
  assert.equal(client.getSnapshot().error, 'offline')
})

test('sends are serialized so each carries its predecessor\'s revision', async () => {
  const base = { ...emptyState(), revision: 1, entries: [entry] }
  const t = transport([
    reply(200, { state: base }),
    reply(200, { state: { ...base, revision: 2, appearance: { ...base.appearance, blur: 1 } } }),
    reply(200, { state: { ...base, revision: 3, appearance: { ...base.appearance, blur: 2 } } }),
  ])
  const client = createStateClient(t.fetch)
  await client.refresh()
  await Promise.all([
    client.send({ type: 'set-appearance', patch: { blur: 1 } }),
    client.send({ type: 'set-appearance', patch: { blur: 2 } }),
  ])
  assert.deepEqual(t.calls.slice(1).map((c) => c.body.baseRevision), [1, 2])
})
