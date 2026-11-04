import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createContentSearch } from '../src/client/content-search.ts'

/** Manual clock plus a search stub whose calls resolve on demand. */
function harness() {
  const timers = new Map()
  let nextId = 1
  const calls = []
  const errors = []
  const search = createContentSearch({
    delayMs: 100,
    setTimeout: (fn) => { const id = nextId++; timers.set(id, fn); return id },
    clearTimeout: (id) => { timers.delete(id) },
    search: (query, signal) => new Promise((resolve, reject) => {
      calls.push({ query, signal, resolve, reject })
    }),
    onError: e => errors.push(e),
  })
  const flushTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } }
  const tick = () => new Promise(r => setImmediate(r))
  return { search, calls, errors, timers, flushTimers, tick }
}

const hits = (...ids) => ({ ok: true, value: { items: ids.map(sessionId => ({ sessionId, snippet: sessionId })), hasMore: false } })

test('debounces typing into one request and publishes its result', async () => {
  const h = harness()
  for (const q of ['l', 'lo', 'log', 'logi', 'login ']) h.search.update(q)
  assert.equal(h.search.getSnapshot().status, 'pending')
  assert.equal(h.timers.size, 1)
  h.flushTimers()
  assert.deepEqual(h.calls.map(c => c.query), ['login'])
  h.calls[0].resolve(hits('s1'))
  await h.tick()
  assert.deepEqual(h.search.getSnapshot(), { query: 'login', status: 'done', hits: [{ sessionId: 's1', snippet: 's1' }] })
})

test('a newer query aborts the old request and its late answer is dropped', async () => {
  const h = harness()
  h.search.update('alpha')
  h.flushTimers()
  h.search.update('beta')
  assert.equal(h.calls[0].signal.aborted, true)
  h.flushTimers()
  h.calls[1].resolve(hits('b'))
  h.calls[0].resolve(hits('a'))
  await h.tick()
  assert.equal(h.search.getSnapshot().query, 'beta')
  assert.deepEqual(h.search.getSnapshot().hits.map(x => x.sessionId), ['b'])
})

test('short queries go idle without a request, failures land in error', async () => {
  const h = harness()
  h.search.update('ab')
  h.search.update(' a ')
  assert.deepEqual(h.search.getSnapshot(), { query: '', status: 'idle', hits: [] })
  assert.equal(h.timers.size, 0)

  for (const fail of [
    c => c.resolve({ ok: false, error: { message: 'index unavailable' } }),
    c => c.reject(new Error('transport')),
  ]) {
    h.search.update(`q${h.calls.length}`)
    h.flushTimers()
    fail(h.calls.at(-1))
    await h.tick()
    assert.equal(h.search.getSnapshot().status, 'error')
    assert.deepEqual(h.search.getSnapshot().hits, [])
  }
  assert.equal(h.errors.length, 2)
})

test('a deployment with search switched off goes quiet: idle, no warning, no further requests', async () => {
  const h = harness()
  h.search.update('first')
  h.flushTimers()
  h.calls[0].resolve({ ok: false, error: { message: 'session search failed: SessionQueryError: session search is disabled: openAt "never"' } })
  await h.tick()
  assert.deepEqual(h.search.getSnapshot(), { query: '', status: 'idle', hits: [] })
  assert.equal(h.errors.length, 0)
  h.search.update('second')
  assert.equal(h.timers.size, 0)
  assert.equal(h.calls.length, 1)
})

test('dispose cancels the timer and the request in flight', async () => {
  const h = harness()
  h.search.update('one')
  h.flushTimers()
  h.search.update('two')
  h.search.dispose()
  assert.equal(h.timers.size, 0)
  assert.equal(h.calls[0].signal.aborted, true)
  h.search.update('three')
  assert.equal(h.timers.size, 0)
})
