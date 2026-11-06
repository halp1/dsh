/**
 * Settings persistence: every read must survive a corrupt, partial, or
 * unavailable store, because a preference cannot be allowed to break boot.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  RECENCY_SETTINGS_KEY,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from '../src/client/settings.ts'

/** An in-memory stand-in for localStorage. */
function storage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    read: key => map.get(key) ?? null,
  }
}

test('defaults sort everything and do not pin', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    enabled: true,
    pinCurrent: false,
    sortUngroupedSessions: true,
    moveUngroupedFolder: true,
  })
})

test('absent storage yields the defaults', () => {
  assert.deepEqual(loadSettings(undefined), DEFAULT_SETTINGS)
})

test('an empty store yields the defaults', () => {
  assert.deepEqual(loadSettings(storage()), DEFAULT_SETTINGS)
})

test('a round trip preserves settings', () => {
  const store = storage()
  const custom = { enabled: false, pinCurrent: true, sortUngroupedSessions: false, moveUngroupedFolder: false }
  saveSettings(store, custom)
  assert.deepEqual(loadSettings(store), custom)
})

test('corrupt JSON falls back to the defaults', () => {
  assert.deepEqual(loadSettings(storage({ [RECENCY_SETTINGS_KEY]: '{not json' })), DEFAULT_SETTINGS)
})

test('a partial value fills missing fields from the defaults', () => {
  const store = storage({ [RECENCY_SETTINGS_KEY]: JSON.stringify({ pinCurrent: true }) })
  assert.deepEqual(loadSettings(store), { ...DEFAULT_SETTINGS, pinCurrent: true })
})

test('wrongly typed fields fall back per field', () => {
  assert.deepEqual(
    normalizeSettings({ enabled: 'yes', pinCurrent: true, moveUngroupedFolder: 0 }),
    { ...DEFAULT_SETTINGS, pinCurrent: true },
  )
})

test('non-object values normalize to the defaults', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings(42), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings([]), DEFAULT_SETTINGS)
})

test('settings saved by the first release gain the new fields', () => {
  const store = storage({ [RECENCY_SETTINGS_KEY]: JSON.stringify({ enabled: true, pinCurrent: false }) })
  assert.deepEqual(loadSettings(store), DEFAULT_SETTINGS)
})

test('a throwing store does not propagate', () => {
  const hostile = {
    getItem() { throw new Error('denied') },
    setItem() { throw new Error('denied') },
  }
  assert.deepEqual(loadSettings(hostile), DEFAULT_SETTINGS)
  assert.doesNotThrow(() => { saveSettings(hostile, DEFAULT_SETTINGS) })
})

test('saving with no storage is a no-op', () => {
  assert.doesNotThrow(() => { saveSettings(undefined, DEFAULT_SETTINGS) })
})
