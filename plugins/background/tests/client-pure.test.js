/**
 * Pure browser-side logic: pool building, rotation scheduling, token overrides.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPool, fileUrl } from '../src/client/pool.ts'
import { msUntilNext, permutation, pickIndex } from '../src/client/rotation.ts'
import { FALLBACK_VALUES, buildOverrides, readBaseFromRules, translucent } from '../src/client/tokens.ts'
import { DEFAULT_APPEARANCE, emptyState } from '../src/shared/state.ts'

const url = (id, over = {}) => ({ id, kind: 'url', source: `https://x.test/${id}.png`, inRotation: true, ...over })
const folder = (id, over = {}) => ({ id, kind: 'folder', source: `/pics/${id}`, inRotation: true, ...over })
const file = (id, over = {}) => ({ id, kind: 'file', source: `/pics/${id}.png`, inRotation: true, ...over })
const info = (folders = {}, files = {}) => ({ folders, files })
const pickFirst = () => 0

test('rotation off, nothing active → empty pool', () => {
  assert.deepEqual(buildPool({ ...emptyState(), entries: [url('a')] }, info(), pickFirst), [])
})

test('rotation off → only the active entry, URL used directly', () => {
  const pool = buildPool({ ...emptyState(), entries: [url('a'), url('b')], activeId: 'b' }, info(), pickFirst)
  assert.deepEqual(pool, [{ key: 'b#0', entryId: 'b', index: 0, url: 'https://x.test/b.png', appearance: DEFAULT_APPEARANCE }])
})

test('rotation off, active folder → one image chosen by the picker', () => {
  const seen = []
  const pool = buildPool(
    { ...emptyState(), entries: [folder('f')], activeId: 'f' },
    info({ f: { count: 5 } }),
    (id, count) => { seen.push([id, count]); return 3 },
  )
  assert.deepEqual(seen, [['f', 5]])
  assert.deepEqual(pool.map((p) => p.url), [fileUrl('f', 3)])
})

test('rotation on → inRotation entries, folders expanded, library order', () => {
  const state = {
    ...emptyState(),
    entries: [url('a'), folder('f'), url('x', { inRotation: false }), file('g')],
    rotation: { enabled: true, intervalMin: 15, order: 'sequential' },
  }
  const pool = buildPool(state, info({ f: { count: 2 } }, { g: { ok: true } }), pickFirst)
  assert.deepEqual(pool.map((p) => p.key), ['a#0', 'f#0', 'f#1', 'g#0'])
})

test('rotation on with nothing in rotation → falls back to the active entry', () => {
  const state = {
    ...emptyState(),
    entries: [url('a', { inRotation: false })],
    activeId: 'a',
    rotation: { enabled: true, intervalMin: 15, order: 'shuffle' },
  }
  assert.deepEqual(buildPool(state, info(), pickFirst).map((p) => p.key), ['a#0'])
})

test('broken folders and missing files contribute nothing', () => {
  const state = {
    ...emptyState(),
    entries: [folder('f'), file('g'), folder('h')],
    rotation: { enabled: true, intervalMin: 15, order: 'shuffle' },
  }
  assert.deepEqual(buildPool(state, info({ f: { error: 'cannot be read' } }, { g: { ok: false } }), pickFirst), [])
})

test('entry overrides are merged into each item appearance', () => {
  const state = { ...emptyState(), entries: [url('a', { overrides: { blur: 12, fit: 'tile' } })], activeId: 'a' }
  assert.deepEqual(buildPool(state, info(), pickFirst)[0].appearance, { ...DEFAULT_APPEARANCE, blur: 12, fit: 'tile' })
})

test('fileUrl is relative and escapes the id', () => {
  assert.equal(fileUrl('a b', 2), 'api/dsh-background.file?entry=a%20b&i=2')
})

const MIN = 60_000
test('sequential rotation advances one per interval and wraps', () => {
  const at = (slot) => pickIndex(slot * 15 * MIN + 5, 15, 3, 'sequential', 'k')
  assert.deepEqual([0, 1, 2, 3, 4].map(at), [0, 1, 2, 0, 1])
})

test('shuffle visits every item once per cycle, deterministically', () => {
  const cycle = (c) => Array.from({ length: 5 }, (_, i) => pickIndex((c * 5 + i) * MIN, 1, 5, 'shuffle', 'pool-key'))
  assert.deepEqual([...cycle(7)].sort(), [0, 1, 2, 3, 4])
  assert.deepEqual(cycle(7), cycle(7))
  const cycles = Array.from({ length: 6 }, (_, c) => cycle(c).join())
  assert.ok(new Set(cycles).size > 1, 'order changes between cycles')
})

test('pickIndex handles tiny pools', () => {
  assert.equal(pickIndex(123456789, 1, 0, 'shuffle', 'k'), 0)
  assert.equal(pickIndex(123456789, 1, 1, 'sequential', 'k'), 0)
})

test('permutation is a permutation', () => {
  assert.deepEqual([...permutation(10, 42)].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('msUntilNext counts to the next boundary', () => {
  assert.equal(msUntilNext(0, 1), MIN)
  assert.equal(msUntilNext(MIN - 1, 1), 1)
  assert.equal(msUntilNext(90 * 1000, 1), 30 * 1000)
})

test('translucent leaves opaque values alone and mixes the rest', () => {
  assert.equal(translucent('var(--c)', 1), 'var(--c)')
  assert.equal(translucent('var(--c)', 0.85), 'color-mix(in srgb, var(--c) 85%, transparent)')
})

test('buildOverrides: surfaces go transparent, one tint carries the opacity, floating layers keep a 0.9 floor', () => {
  const o = buildOverrides(FALLBACK_VALUES, 0.5)
  assert.deepEqual(o['--dsw-alias-bg-base'], { light: 'transparent', dark: 'transparent' })
  assert.deepEqual(o['--dsw-specific-sidebar-fill'], { light: 'transparent', dark: 'transparent' })
  assert.equal(o['--dsh-background-tint'].light, 'color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 50%, transparent)')
  assert.equal(o['--dsh-background-tint'].dark, 'color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 50%, transparent)')
  assert.equal(o['--dsw-alias-bg-layer-2'].dark, 'color-mix(in srgb, var(--dsw-static-neutral-bluish-850) 90%, transparent)')
  const high = buildOverrides(FALLBACK_VALUES, 0.95)
  assert.match(high['--dsw-alias-bg-overlay'].light, / 95%/)
})

test('buildOverrides at full opacity restores the raw surfaces', () => {
  const o = buildOverrides(FALLBACK_VALUES, 1)
  assert.equal(o['--dsw-alias-bg-base'].dark, 'var(--dsw-static-neutral-bluish-950)')
  assert.equal(o['--dsh-background-tint'].dark, 'var(--dsw-static-neutral-bluish-950)')
})

test('readBaseFromRules separates light and dark rules and falls back', () => {
  const rule = (selectorText, values) => ({ selectorText, style: { getPropertyValue: (n) => values[n] ?? '' } })
  const base = readBaseFromRules([
    rule('html', { '--dsw-alias-bg-base': 'red' }),
    rule('body', { '--dsw-alias-bg-base': ' #fff ' }),
    rule('body[data-ds-dark-theme]', { '--dsw-alias-bg-base': '#111' }),
    { selectorText: undefined },
  ])
  assert.equal(base.light['--dsw-alias-bg-base'], '#fff')
  assert.equal(base.dark['--dsw-alias-bg-base'], '#111')
  assert.equal(base.dark['--dsw-alias-bg-overlay'], FALLBACK_VALUES.dark['--dsw-alias-bg-overlay'])
})
