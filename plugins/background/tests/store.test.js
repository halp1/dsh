/**
 * State file persistence: atomic writes, corrupt-file quarantine, revisions.
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateStore, defaultStateFile } from '../src/node/store.ts'
import { emptyState } from '../src/shared/state.ts'

let dir
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dsh-bg-store-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

test('defaultStateFile honours a non-blank DSH_HOME, else ~/.dsh', () => {
  assert.equal(defaultStateFile({ DSH_HOME: '/srv/dsh' }, '/home/u'), '/srv/dsh/plugins/background/state.json')
  assert.equal(defaultStateFile({ DSH_HOME: '   ' }, '/home/u'), '/home/u/.dsh/plugins/background/state.json')
  assert.equal(defaultStateFile({}, '/home/u'), '/home/u/.dsh/plugins/background/state.json')
})

test('a missing file loads as the empty state without creating anything', async () => {
  const store = new StateStore(join(dir, 'sub', 'state.json'))
  assert.deepEqual(await store.load(), emptyState())
  assert.deepEqual(await readdir(dir), [])
})

test('save bumps the revision, creates directories, and round-trips', async () => {
  const file = join(dir, 'sub', 'state.json')
  const store = new StateStore(file)
  await store.load()
  const saved = await store.save({ ...emptyState(), appearance: { ...emptyState().appearance, blur: 5 } })
  assert.equal(saved.revision, 1)
  assert.equal(store.current.revision, 1)
  const again = await new StateStore(file).load()
  assert.equal(again.revision, 1)
  assert.equal(again.appearance.blur, 5)
  assert.deepEqual(await readdir(join(dir, 'sub')), ['state.json'], 'no temp file left behind')
})

test('a corrupt file is quarantined and replaced by the empty state', async () => {
  const file = join(dir, 'state.json')
  await writeFile(file, '{ not json')
  const logs = []
  const store = new StateStore(file, (m) => logs.push(m))
  assert.deepEqual(await store.load(), emptyState())
  const names = await readdir(dir)
  const bad = names.find((n) => n.startsWith('state.json.bad-'))
  assert.ok(bad, `quarantine file present in ${names}`)
  assert.equal(await readFile(join(dir, bad), 'utf8'), '{ not json')
  assert.equal(names.includes('state.json'), false)
  assert.equal(logs.length, 1)
})

test('a structurally invalid file is normalized, not quarantined', async () => {
  const file = join(dir, 'state.json')
  await writeFile(file, JSON.stringify({ revision: 3, entries: [{ nope: 1 }], appearance: { opacity: 9 } }))
  const state = await new StateStore(file).load()
  assert.equal(state.revision, 3)
  assert.deepEqual(state.entries, [])
  assert.equal(state.appearance.opacity, 1)
})

test('update serializes read-modify-write so concurrent edits all land', async () => {
  const store = new StateStore(join(dir, 'state.json'))
  await store.load()
  const results = await Promise.all([1, 2, 3].map((n) => store.update((s) => ({
    ...s,
    entries: [...s.entries, { id: `e${n}`, kind: 'url', source: `https://x.test/${n}.png`, inRotation: true }],
  }))))
  assert.deepEqual(results.map((s) => s.revision).sort(), [1, 2, 3])
  assert.equal(store.current.entries.length, 3)
})
