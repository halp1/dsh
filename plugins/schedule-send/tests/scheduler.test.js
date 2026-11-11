import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { QueueStore } from '../src/node/store.ts'
import { MAX_ATTEMPTS, MAX_TIMER_MS, PermanentDeliveryError, Scheduler, backoffMs } from '../src/node/scheduler.ts'
import { deliverVia } from '../src/index.ts'

let dir
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dss-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

/** Manual clock: `setTimeout` records the single pending timer. */
function fakeClock(start) {
  const clock = {
    t: start,
    timer: undefined,
    now: () => clock.t,
    setTimeout: (fn, ms) => { clock.timer = { fn, ms }; return clock.timer },
    clearTimeout: (h) => { if (clock.timer === h) clock.timer = undefined },
    fire: () => { const t = clock.timer; clock.timer = undefined; t.fn() },
  }
  return clock
}

const T0 = Date.parse('2026-11-11T19:00:00Z')
const item = (id, offsetMs, extra = {}) => ({
  id, sessionId: 's1', text: `msg ${id}`, sendAt: new Date(T0 + offsetMs).toISOString(),
  createdAt: new Date(T0).toISOString(), status: 'pending', attempts: 0, ...extra,
})

async function setup(items, deliver) {
  const store = new QueueStore(join(dir, 'queue.json'))
  await store.load()
  await store.update(() => items)
  const clock = fakeClock(T0)
  const scheduler = new Scheduler({ store, deliver, clock })
  return { store, clock, scheduler }
}

test('delivers due items in time order, persists removal, and survives reload', async () => {
  const sent = []
  const { store, clock, scheduler } = await setup(
    [item('c', 5 * 60_000), item('b', -1_000), item('a', -60_000)],
    async (i) => { sent.push(i.id) },
  )
  await scheduler.drain()
  assert.deepEqual(sent, ['a', 'b'])
  assert.deepEqual(store.current.map((i) => i.id), ['c'])
  assert.equal(clock.timer.ms, 5 * 60_000)

  clock.t += 5 * 60_000
  clock.fire()
  await scheduler.drain()
  assert.deepEqual(sent, ['a', 'b', 'c'])
  assert.equal(clock.timer, undefined)

  const reloaded = new QueueStore(store.file)
  assert.deepEqual(await reloaded.load(), [])
})

test('transient failures back off then fail; permanent failures fail at once', async () => {
  const { store, clock, scheduler } = await setup(
    [item('flaky', 0), item('gone', 0)],
    async (i) => { throw i.id === 'gone' ? new PermanentDeliveryError('session gone') : new Error('busy') },
  )
  await scheduler.drain()
  let flaky = store.current.find((i) => i.id === 'flaky')
  const gone = store.current.find((i) => i.id === 'gone')
  assert.equal(gone.status, 'failed')
  assert.equal(gone.lastError, 'session gone')
  assert.equal(flaky.status, 'pending')
  assert.equal(Date.parse(flaky.sendAt), T0 + backoffMs(1))

  for (let n = 2; n <= MAX_ATTEMPTS; n++) {
    clock.t = Date.parse(flaky.sendAt)
    await scheduler.drain()
    flaky = store.current.find((i) => i.id === 'flaky')
  }
  assert.equal(flaky.status, 'failed')
  assert.equal(flaky.attempts, MAX_ATTEMPTS)
  assert.equal(clock.timer, undefined, 'failed items do not arm the timer')
})

test('a far-off item arms a capped timer that re-arms instead of firing early', async () => {
  const sent = []
  const far = 40 * 86_400_000
  const { clock, scheduler } = await setup([item('far', far)], async (i) => { sent.push(i.id) })
  scheduler.arm()
  assert.equal(clock.timer.ms, MAX_TIMER_MS)
  clock.t += MAX_TIMER_MS
  clock.fire()
  await scheduler.drain()
  assert.deepEqual(sent, [])
  assert.equal(clock.timer.ms, far - MAX_TIMER_MS)
})

test('an item cancelled while an earlier one is delivering is skipped', async () => {
  const sent = []
  let store
  const ctx = await setup([item('a', -2), item('b', -1)], async (i) => {
    sent.push(i.id)
    if (i.id === 'a') await store.update((all) => all.filter((x) => x.id !== 'b'))
  })
  store = ctx.store
  await ctx.scheduler.drain()
  assert.deepEqual(sent, ['a'])
})

test('a corrupt queue file is moved aside and the queue starts empty', async () => {
  const file = join(dir, 'queue.json')
  await writeFile(file, '{ nope')
  const store = new QueueStore(file)
  assert.deepEqual(await store.load(), [])
  const names = await readdir(dir)
  assert.ok(names.some((n) => n.startsWith('queue.json.bad-')))
})

test('delivery puts text first, inlines images, uploads files for receipts, and classifies permanent errors', async () => {
  const calls = []
  const uploads = []
  const blobs = { 'x:0': Buffer.from('IMG'), 'x:1': Buffer.from('DOC') }
  const deps = {
    controller: {
      prompt: async (req) => { calls.push(req) },
      resolveAgent: async (id) => ({ agent: { id } }),
    },
    uploads: { upload: async (agent, req) => { uploads.push([agent.id, req]); return { receiptId: 'r1' } } },
    readBlob: async (id, i) => { const b = blobs[`${id}:${i}`]; if (!b) throw new Error('ENOENT'); return b },
  }
  await deliverVia(deps, item('x', 0, {
    clientTimeZone: 'America/Chicago',
    attachments: [
      { kind: 'image', name: 'a.png', mediaType: 'image/png', size: 3 },
      { kind: 'file', name: 'b.txt', mediaType: 'text/plain', size: 3 },
    ],
  }))
  assert.equal(calls[0].requestId, 'x')
  assert.equal(calls[0].mode, 'queue')
  assert.equal(calls[0].clientTimeZone, 'America/Chicago')
  assert.deepEqual(calls[0].content, [
    { type: 'text', text: 'msg x' },
    { type: 'image', mediaType: 'image/png', data: Buffer.from('IMG').toString('base64'), name: 'a.png' },
    { type: 'file', receiptId: 'r1' },
  ])
  assert.deepEqual(uploads, [['s1', { data: Buffer.from('DOC').toString('base64'), name: 'b.txt' }]])

  // Attachments only: no empty text part.
  await deliverVia(deps, item('x', 0, { text: '', attachments: [{ kind: 'image', name: '', mediaType: 'image/png', size: 3 }] }))
  assert.equal(calls[1].content.length, 1)
  assert.equal(calls[1].content[0].type, 'image')

  const notFound = Object.assign(new Error('session "s1" not found'), { code: 'session/not-found' })
  await assert.rejects(deliverVia({ ...deps, controller: { ...deps.controller, prompt: async () => { throw notFound } } }, item('y', 0)), PermanentDeliveryError)
  await assert.rejects(deliverVia(deps, item('gone', 0, { attachments: [{ kind: 'file', name: 'z', mediaType: '', size: 1 }] })), PermanentDeliveryError)
  await assert.rejects(deliverVia({ ...deps, controller: { ...deps.controller, prompt: async () => { throw new Error('busy') } } }, item('z', 0)), (e) => !(e instanceof PermanentDeliveryError))
})

test('a delivered item triggers cleanup; a failed one does not', async () => {
  const cleaned = []
  const store = new QueueStore(join(dir, 'queue.json'))
  await store.load()
  await store.update(() => [item('ok', -1), item('bad', -1)])
  const scheduler = new Scheduler({
    store,
    clock: fakeClock(T0),
    deliver: async (i) => { if (i.id === 'bad') throw new PermanentDeliveryError('no') },
    delivered: async (i) => { cleaned.push(i.id) },
  })
  await scheduler.drain()
  assert.deepEqual(cleaned, ['ok'])
  assert.equal(store.current[0].status, 'failed')
})
