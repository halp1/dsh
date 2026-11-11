import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAbsolute, formatRelative, resolveAbsolute, resolveRelative, validate } from '../src/shared/when.ts'

const now = new Date(2026, 10, 11, 13, 30) // Wed Nov 11 2026 13:30 local

test('relative and absolute resolution', () => {
  assert.equal(resolveRelative(90, 'm', now).getTime(), now.getTime() + 90 * 60_000)
  assert.equal(resolveRelative(2, 'd', now).getTime(), now.getTime() + 2 * 86_400_000)
  for (const amount of [0, -1, Number.NaN, Infinity]) assert.equal(resolveRelative(amount, 'h', now), null)

  assert.deepEqual(resolveAbsolute('2026-11-12', '09:05'), new Date(2026, 10, 12, 9, 5))
  for (const [d, t] of [['2026-02-31', '09:00'], ['2026-11-12', '24:00'], ['11/12/2026', '09:00'], ['2026-11-12', '9:00'], ['', '']]) {
    assert.equal(resolveAbsolute(d, t), null, `${d} ${t}`)
  }
})

test('validity window', () => {
  const at = (ms) => new Date(now.getTime() + ms)
  assert.equal(validate(at(-1), now), 'past')
  assert.equal(validate(at(10_000), now), 'past')
  assert.equal(validate(at(60_000), now), 'ok')
  assert.equal(validate(at(367 * 86_400_000), now), 'too-far')
})

test('labels use calendar days, not 24 hour spans', () => {
  assert.match(formatAbsolute(new Date(2026, 10, 11, 23, 59), now, 'en-US'), /^Today, 11:59\sPM$/)
  // 11 hours ahead but on the next calendar day.
  assert.match(formatAbsolute(new Date(2026, 10, 12, 0, 30), now, 'en-US'), /^Tomorrow, 12:30\sAM$/)
  assert.match(formatAbsolute(new Date(2026, 10, 13, 9, 0), now, 'en-US'), /^Fri, Nov 13, 9:00\sAM$/)
  assert.match(formatAbsolute(new Date(2027, 0, 4, 9, 0), now, 'en-US'), /^Jan 4, 2027, 9:00\sAM$/)

  const cases = [[20_000, 'in 1 min'], [45 * 60_000, 'in 45 min'], [3 * 3_600_000, 'in 3 hr'], [(3 * 60 + 20) * 60_000, 'in 3 hr 20 min'], [5 * 86_400_000, 'in 5 days']]
  for (const [ms, label] of cases) assert.equal(formatRelative(ms), label)
})
