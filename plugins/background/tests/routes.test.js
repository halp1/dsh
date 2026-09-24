/**
 * The /api/dsh-background.* handlers, exercised as plain Fetch functions.
 */
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateStore } from '../src/node/store.ts'
import { handleFile, handleGetState, handlePostState } from '../src/node/routes.ts'

let root
let store
let deps
before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-bg-routes-')))
  await mkdir(join(root, 'pics'))
  await writeFile(join(root, 'pics', 'a.png'), 'AAAA')
  await writeFile(join(root, 'pics', 'b.jpg'), 'BBBB')
  await writeFile(join(root, 'single.webp'), 'WEBP')
})
after(async () => { await rm(root, { recursive: true, force: true }) })
beforeEach(async () => {
  store = new StateStore(join(root, `state-${Math.random()}.json`))
  await store.load()
  deps = { store }
})

const post = (body) => new Request('http://h/api/dsh-background.state', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const get = (qs, init = {}) => new Request(`http://h/api/dsh-background.file?${qs}`, init)
async function add(source) {
  const res = await handlePostState(post({ baseRevision: store.current.revision, op: { type: 'add', source } }), deps)
  assert.equal(res.status, 200, await res.clone().text())
  const body = await res.json()
  return body.state.entries.at(-1)
}

test('GET state returns the state plus folder and file info', async () => {
  const folder = await add(join(root, 'pics'))
  const file = await add(join(root, 'single.webp'))
  const url = await add('https://x.test/sky.png')
  const body = await (await handleGetState(deps)).json()
  assert.equal(body.state.entries.length, 3)
  assert.deepEqual(body.folders[folder.id], { count: 2, names: ['a.png', 'b.jpg'] })
  assert.deepEqual(body.files[file.id], { ok: true })
  assert.equal(body.folders[url.id], undefined)
})

test('POST add validates on the host and classifies the source', async () => {
  const folder = await add(join(root, 'pics'))
  assert.equal(folder.kind, 'folder')
  assert.equal(folder.inRotation, true)
  assert.match(folder.id, /^[0-9a-z]{12}$/)
  assert.equal((await add('https://x.test/a.png')).kind, 'url')
})

test('POST add of a bad path is a 400 with the user-facing reason', async () => {
  const res = await handlePostState(post({ baseRevision: 0, op: { type: 'add', source: join(root, 'missing.png') } }), deps)
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /does not exist/)
  assert.equal(store.current.revision, 0, 'nothing saved')
})

test('POST with a stale baseRevision is a 409 carrying the fresh state', async () => {
  await add('https://x.test/a.png')
  const res = await handlePostState(post({ baseRevision: 0, op: { type: 'set-active', id: null } }), deps)
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.error, 'stale')
  assert.equal(body.state.revision, 1)
  assert.equal(body.state.entries.length, 1)
})

test('POST with a malformed body or op is a 400', async () => {
  assert.equal((await handlePostState(post({ baseRevision: 0, op: { type: 'explode' } }), deps)).status, 400)
  assert.equal((await handlePostState(post({ op: { type: 'set-active', id: null } }), deps)).status, 400)
  const notJson = new Request('http://h/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
  assert.equal((await handlePostState(notJson, deps)).status, 400)
})

test('POST ops round-trip through the store', async () => {
  const e = await add('https://x.test/a.png')
  const res = await handlePostState(post({ baseRevision: store.current.revision, op: { type: 'set-active', id: e.id } }), deps)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).state.activeId, e.id)
  assert.equal(store.current.activeId, e.id)
})

test('file route streams a file entry with type, cache headers, and ETag', async () => {
  const e = await add(join(root, 'single.webp'))
  const res = await handleFile(get(`entry=${e.id}`), deps)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/webp')
  assert.match(res.headers.get('cache-control'), /private/)
  assert.ok(res.headers.get('etag'))
  assert.equal(await res.text(), 'WEBP')
  const again = await handleFile(get(`entry=${e.id}`, { headers: { 'if-none-match': res.headers.get('etag') } }), deps)
  assert.equal(again.status, 304)
})

test('file route indexes into a folder entry', async () => {
  const e = await add(join(root, 'pics'))
  assert.equal(await (await handleFile(get(`entry=${e.id}&i=1`), deps)).text(), 'BBBB')
  assert.equal((await handleFile(get(`entry=${e.id}&i=0`), deps)).headers.get('content-type'), 'image/png')
})

test('file route 404s on unknown entries, URL entries, bad or out-of-range indexes', async () => {
  const folder = await add(join(root, 'pics'))
  const url = await add('https://x.test/a.png')
  for (const qs of ['entry=nope', `entry=${url.id}`, `entry=${folder.id}&i=2`, `entry=${folder.id}&i=-1`, `entry=${folder.id}&i=x`, `entry=${folder.id}`, '']) {
    assert.equal((await handleFile(get(qs), deps)).status, 404, qs)
  }
})

test('file route 404s when a file entry was deleted from disk', async () => {
  const path = join(root, 'gone.png')
  await writeFile(path, 'G')
  const e = await add(path)
  await unlink(path)
  assert.equal((await handleFile(get(`entry=${e.id}`), deps)).status, 404)
})

test('HEAD returns headers without a body', async () => {
  const e = await add(join(root, 'single.webp'))
  const res = await handleFile(get(`entry=${e.id}`, { method: 'HEAD' }), deps)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-length'), '4')
  assert.equal(await res.text(), '')
})
