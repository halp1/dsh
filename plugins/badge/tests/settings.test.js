/**
 * Settings persistence: defensive reads, since a corrupt localStorage value
 * must never be able to break the client boot.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BADGE_SETTINGS_KEY,
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../src/client/settings.ts'

/** An in-memory localStorage double. */
function storage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v) },
    read: (k) => map.get(k),
  }
}

test('defaults badge on, counting attention and completed only', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    enabled: true,
    countCompleted: true,
    countAttention: true,
    countRunning: false,
    mirrorTitle: false,
  })
})

test('returns defaults with no stored value', () => {
  assert.deepEqual(loadSettings(storage()), DEFAULT_SETTINGS)
})

test('returns defaults without a storage backend', () => {
  assert.deepEqual(loadSettings(undefined), DEFAULT_SETTINGS)
})

test('round-trips a saved value', () => {
  const store = storage()
  saveSettings(store, { ...DEFAULT_SETTINGS, mirrorTitle: true, countRunning: true })
  const loaded = loadSettings(store)
  assert.equal(loaded.mirrorTitle, true)
  assert.equal(loaded.countRunning, true)
  assert.equal(loaded.enabled, true)
})

test('fills missing fields from the defaults', () => {
  const store = storage({ [BADGE_SETTINGS_KEY]: JSON.stringify({ enabled: false }) })
  assert.deepEqual(loadSettings(store), { ...DEFAULT_SETTINGS, enabled: false })
})

test('rejects wrongly-typed fields field by field', () => {
  const store = storage({ [BADGE_SETTINGS_KEY]: JSON.stringify({ enabled: 'yes', mirrorTitle: true }) })
  const loaded = loadSettings(store)
  assert.equal(loaded.enabled, true, 'bad type falls back to the default')
  assert.equal(loaded.mirrorTitle, true, 'good sibling field survives')
})

test('survives corrupt JSON', () => {
  const store = storage({ [BADGE_SETTINGS_KEY]: '{not json' })
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS)
})

test('survives a throwing storage', () => {
  const hostile = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.deepEqual(loadSettings(hostile), DEFAULT_SETTINGS)
  assert.doesNotThrow(() => saveSettings(hostile, DEFAULT_SETTINGS))
})

test('normalizes non-object values', () => {
  for (const value of [null, 42, 'x', undefined, []]) {
    assert.deepEqual(normalizeSettings(value), DEFAULT_SETTINGS)
  }
})

test('saving without a backend is a no-op', () => {
  assert.doesNotThrow(() => saveSettings(undefined, DEFAULT_SETTINGS))
})
