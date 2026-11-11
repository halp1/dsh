import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentStore, QueueStore } from '../src/node/store.ts'
import { handleCancel, handleCreate, handleList, handleSendNow } from '../src/node/routes.ts'

const NOW = Date.parse('2026-11-11T19:00:00Z')
let dir
let deps
let events
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dss-routes-'))
  const store = new QueueStore(join(dir, 'queue.json'))
  await store.load()
  events = []
  deps = { store, blobs: new AttachmentStore(store.file), now: () => NOW, changed: () => events.push('changed'), drain: () => events.push('drain') }
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const post = (body) => new Request('http://h/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const valid = { sessionId: 's1', text: ' hi ', sendAt: new Date(NOW + 3_600_000).toISOString(), clientTimeZone: 'America/Chicago' }

test('create validates input and rejects past or far times', async () => {
  const cases = [
    [{ ...valid, text: '   ' }, 400],
    [{ ...valid, sessionId: '' }, 400],
    [{ ...valid, sendAt: 'tomorrow' }, 400],
    [{ ...valid, sendAt: new Date(NOW - 120_000).toISOString() }, 400],
    [{ ...valid, sendAt: new Date(NOW + 400 * 86_400_000).toISOString() }, 400],
    [{ ...valid, clientTimeZone: 'Mars/Olympus' }, 400],
    [valid, 200],
  ]
  for (const [input, status] of cases) {
    const res = await handleCreate(post(input), deps)
    assert.equal(res.status, status, JSON.stringify(input))
  }
  assert.equal(deps.store.current.length, 1)
  assert.equal(deps.store.current[0].text, 'hi')
  assert.deepEqual(events, ['changed'])
})

test('list filters by session, cancel returns the item, send-now makes it due and drains', async () => {
  await handleCreate(post(valid), deps)
  await handleCreate(post({ ...valid, sessionId: 's2' }), deps)
  const list = await (await handleList(new Request('http://h/x?sessionId=s1'), deps)).json()
  assert.equal(list.items.length, 1)
  const { id } = list.items[0]

  const sent = await (await handleSendNow(post({ id }), deps)).json()
  assert.equal(sent.item.sendAt, new Date(NOW).toISOString())
  assert.equal(events.at(-1), 'drain')

  const cancelled = await handleCancel(post({ id }), deps)
  assert.equal((await cancelled.json()).item.text, 'hi')
  assert.equal((await handleCancel(post({ id }), deps)).status, 404)
  assert.equal(deps.store.current.length, 1)
})

const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')

test('attachments-only messages are accepted, stored on disk, and returned by cancel', async () => {
  const attachments = [
    { kind: 'image', name: 'shot.png', mediaType: 'image/png', data: png },
    { kind: 'file', name: 'notes.txt', mediaType: 'text/plain', data: Buffer.from('hello').toString('base64') },
  ]
  const res = await handleCreate(post({ ...valid, text: '', attachments }), deps)
  assert.equal(res.status, 200, await res.clone().text())
  const { item } = await res.json()
  assert.equal(item.text, '')
  assert.deepEqual(item.attachments.map((a) => [a.kind, a.name, a.size]), [['image', 'shot.png', 8], ['file', 'notes.txt', 5]])
  assert.equal((await deps.blobs.read(item.id, 1)).toString(), 'hello')

  const cancelled = await (await handleCancel(post({ id: item.id }), deps)).json()
  assert.deepEqual(cancelled.attachments.map((a) => a.data), [png, Buffer.from('hello').toString('base64')])
  await assert.rejects(deps.blobs.read(item.id, 0), 'bytes are deleted with the item')
})

test('bad attachments are rejected before anything is stored', async () => {
  const cases = [
    { ...valid, text: '', attachments: [] },
    { ...valid, attachments: [{ kind: 'image', name: 'a.svg', mediaType: 'image/svg+xml', data: png }] },
    { ...valid, attachments: [{ kind: 'file', name: 'x', mediaType: '', data: 'not base64!' }] },
    { ...valid, attachments: [{ kind: 'video', name: 'x', mediaType: '', data: png }] },
    { ...valid, attachments: 'nope' },
  ]
  for (const input of cases) assert.equal((await handleCreate(post(input), deps)).status, 400, JSON.stringify(input))
  assert.equal(deps.store.current.length, 0)
})
