/**
 * Applier behaviour: feature detection, deduplication, and the title mirror.
 *
 * Deduplication is the load-bearing property — session snapshots invalidate on
 * every stream frame, so an applier that forwarded every publish would issue
 * platform calls continuously while a turn runs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BadgeApplier,
  badgingSupported,
  stripTitleCount,
  titleWithCount,
} from '../src/client/badge.ts'

/** A navigator double recording every badge call. */
function fakeNavigator() {
  const calls = []
  return {
    calls,
    setAppBadge: async (n) => { calls.push(['set', n]) },
    clearAppBadge: async () => { calls.push(['clear']) },
  }
}

test('badgingSupported detects the API', () => {
  assert.equal(badgingSupported(fakeNavigator()), true)
  assert.equal(badgingSupported(undefined), false)
  assert.equal(badgingSupported({}), false)
  assert.equal(badgingSupported({ setAppBadge: () => {} }), false)
})

test('publishes a positive count and clears at zero', () => {
  const nav = fakeNavigator()
  const applier = new BadgeApplier(nav, undefined)
  applier.publish(3)
  applier.publish(0)
  assert.deepEqual(nav.calls, [['set', 3], ['clear']])
})

test('drops a repeat of the last published value', () => {
  const nav = fakeNavigator()
  const applier = new BadgeApplier(nav, undefined)
  assert.equal(applier.publish(2), true)
  assert.equal(applier.publish(2), false)
  assert.equal(applier.publish(2), false)
  assert.equal(applier.publish(5), true)
  assert.deepEqual(nav.calls, [['set', 2], ['set', 5]])
})

test('force republishes an unchanged value', () => {
  const nav = fakeNavigator()
  const applier = new BadgeApplier(nav, undefined)
  applier.publish(2)
  assert.equal(applier.publish(2, true), true)
  assert.deepEqual(nav.calls, [['set', 2], ['set', 2]])
})

test('publishes zero on first call, clearing a stale badge from a previous load', () => {
  const nav = fakeNavigator()
  new BadgeApplier(nav, undefined).publish(0)
  assert.deepEqual(nav.calls, [['clear']])
})

test('normalizes negative and fractional counts', () => {
  const nav = fakeNavigator()
  const applier = new BadgeApplier(nav, undefined)
  applier.publish(-4)
  applier.publish(2.8)
  assert.deepEqual(nav.calls, [['clear'], ['set', 2]])
})

test('reset clears the badge and forgets the baseline', () => {
  const nav = fakeNavigator()
  const applier = new BadgeApplier(nav, undefined)
  applier.publish(0)
  applier.reset()
  assert.equal(applier.current, undefined)
  // The reset write lands even though 0 was already published.
  assert.deepEqual(nav.calls, [['clear'], ['clear']])
})

test('survives a browser without the Badging API', () => {
  const applier = new BadgeApplier({}, undefined)
  assert.doesNotThrow(() => applier.publish(4))
  assert.equal(applier.current, 4)
})

test('survives a platform that throws synchronously', () => {
  const applier = new BadgeApplier({
    setAppBadge: () => { throw new Error('refused') },
    clearAppBadge: () => { throw new Error('refused') },
  }, undefined)
  assert.doesNotThrow(() => applier.publish(1))
})

test('swallows a rejected badge promise', async () => {
  const applier = new BadgeApplier({
    setAppBadge: async () => { throw new Error('permission') },
    clearAppBadge: async () => {},
  }, undefined)
  applier.publish(1)
  // An unhandled rejection would crash the test process on the next tick.
  await new Promise(resolve => setTimeout(resolve, 5))
})

test('title mirror adds, updates, and removes the prefix', () => {
  const doc = { title: 'DeepSeek Harness' }
  const applier = new BadgeApplier(undefined, doc, { mirrorTitle: true })
  applier.publish(2)
  assert.equal(doc.title, '(2) DeepSeek Harness')
  applier.publish(7)
  assert.equal(doc.title, '(7) DeepSeek Harness')
  applier.publish(0)
  assert.equal(doc.title, 'DeepSeek Harness')
})

test('turning the mirror off strips a prefix it wrote', () => {
  const doc = { title: 'DeepSeek Harness' }
  let options = { mirrorTitle: true }
  const applier = new BadgeApplier(undefined, doc, () => options)
  applier.publish(3)
  assert.equal(doc.title, '(3) DeepSeek Harness')
  options = { mirrorTitle: false }
  applier.publish(3, true)
  assert.equal(doc.title, 'DeepSeek Harness')
})

test('title helpers are idempotent', () => {
  assert.equal(titleWithCount('(4) Chat', 2), '(2) Chat')
  assert.equal(titleWithCount('(4) Chat', 0), 'Chat')
  assert.equal(stripTitleCount('(12)  Chat'), 'Chat')
  assert.equal(stripTitleCount('Chat (4)'), 'Chat (4)')
})
