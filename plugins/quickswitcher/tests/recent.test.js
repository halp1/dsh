import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRecent, RECENT_KEY, RECENT_LIMIT } from '../src/client/recent.ts'

function memory(initial) {
  const data = new Map(initial === undefined ? [] : [[RECENT_KEY, initial]])
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}

test('push moves to front, deduplicates, caps, and persists', () => {
  const storage = memory()
  const recent = createRecent(storage)
  for (const id of ['a', 'b', 'c', 'a']) recent.push(id)
  assert.deepEqual(recent.list(), ['a', 'c', 'b'])
  assert.deepEqual(createRecent(storage).list(), ['a', 'c', 'b'])
  for (let i = 0; i < RECENT_LIMIT + 5; i += 1) recent.push(`s${i}`)
  assert.equal(recent.list().length, RECENT_LIMIT)
  assert.equal(recent.list()[0], `s${RECENT_LIMIT + 4}`)
})

test('corrupt or unavailable storage falls back to memory without throwing', () => {
  for (const storage of [
    memory('{not json'),
    memory('{"a":1}'),
    memory('["ok", 3, null, "", "ok"]'),
    { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } },
    undefined,
  ]) {
    const recent = createRecent(storage)
    const before = recent.list().filter(id => id !== 'ok')
    assert.deepEqual(before, [])
    recent.push('x')
    assert.equal(recent.list()[0], 'x')
  }
})
