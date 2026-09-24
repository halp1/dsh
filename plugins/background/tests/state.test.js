/**
 * State model: normalization is the trust boundary for everything read from
 * disk or a POST body, and applyOp is the single mutation path.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_ROTATION,
  applyOp,
  emptyState,
  mergeAppearance,
  newEntryId,
  normalizeOp,
  normalizeState,
} from '../src/shared/state.ts'

const entry = (over = {}) => ({ id: 'a1', kind: 'url', source: 'https://x.test/a.png', inRotation: true, ...over })

test('defaults match the spec', () => {
  assert.deepEqual(DEFAULT_APPEARANCE, { opacity: 0.85, blur: 0, fit: 'cover', position: 'center' })
  assert.deepEqual(DEFAULT_ROTATION, { enabled: false, intervalMin: 15, order: 'shuffle' })
  assert.deepEqual(emptyState(), {
    version: 1, revision: 0, entries: [], activeId: null,
    appearance: DEFAULT_APPEARANCE, rotation: DEFAULT_ROTATION,
  })
})

test('garbage normalizes to the empty state', () => {
  for (const raw of [null, undefined, 42, 'x', [], { entries: 'nope' }]) {
    assert.deepEqual(normalizeState(raw), emptyState())
  }
})

test('numbers are clamped and enums repaired', () => {
  const s = normalizeState({
    appearance: { opacity: 5, blur: -3, fit: 'zoom', position: 'top' },
    rotation: { enabled: true, intervalMin: 0, order: 'random' },
  })
  assert.deepEqual(s.appearance, { opacity: 1, blur: 0, fit: 'cover', position: 'top' })
  assert.deepEqual(s.rotation, { enabled: true, intervalMin: 1, order: 'shuffle' })
  assert.equal(normalizeState({ appearance: { opacity: 0.1 } }).appearance.opacity, 0.3)
  assert.equal(normalizeState({ appearance: { blur: 99 } }).appearance.blur, 40)
  assert.equal(normalizeState({ rotation: { intervalMin: 99999 } }).rotation.intervalMin, 1440)
  assert.equal(normalizeState({ appearance: { opacity: Number.NaN } }).appearance.opacity, 0.85)
})

test('invalid entries are dropped, unknown fields stripped, dangling activeId nulled', () => {
  const s = normalizeState({
    revision: 7,
    junk: true,
    activeId: 'gone',
    entries: [
      entry({ extra: 1, overrides: { blur: 10, bogus: 1, fit: 'nope' } }),
      { id: 'b', kind: 'video', source: '/x' },
      { id: 'c', kind: 'file', source: '' },
      { kind: 'file', source: '/a.png' },
      entry(), // duplicate id
    ],
  })
  assert.equal(s.revision, 7)
  assert.equal('junk' in s, false)
  assert.equal(s.activeId, null)
  assert.deepEqual(s.entries, [{ id: 'a1', kind: 'url', source: 'https://x.test/a.png', inRotation: true, overrides: { blur: 10 } }])
})

test('an entry label survives, and inRotation defaults to true', () => {
  const s = normalizeState({ entries: [{ id: 'z', kind: 'file', source: '/p.png', label: 'Mountains' }], activeId: 'z' })
  assert.deepEqual(s.entries[0], { id: 'z', kind: 'file', source: '/p.png', label: 'Mountains', inRotation: true })
  assert.equal(s.activeId, 'z')
})

test('mergeAppearance lets overrides win field by field', () => {
  assert.deepEqual(mergeAppearance(DEFAULT_APPEARANCE, { blur: 12 }), { ...DEFAULT_APPEARANCE, blur: 12 })
  assert.deepEqual(mergeAppearance(DEFAULT_APPEARANCE, undefined), DEFAULT_APPEARANCE)
})

test('applyOp add appends the validated entry', () => {
  const next = applyOp(emptyState(), { type: 'add', source: 'ignored' }, entry())
  assert.deepEqual(next.entries, [entry()])
})

test('applyOp add of the first entry does not auto-activate it', () => {
  assert.equal(applyOp(emptyState(), { type: 'add', source: 'x' }, entry()).activeId, null)
})

test('applyOp remove drops the entry and clears it when active', () => {
  const s = { ...emptyState(), entries: [entry(), entry({ id: 'b2' })], activeId: 'a1' }
  const next = applyOp(s, { type: 'remove', id: 'a1' })
  assert.deepEqual(next.entries.map((e) => e.id), ['b2'])
  assert.equal(next.activeId, null)
})

test('applyOp update-entry patches label, rotation, overrides; null clears overrides', () => {
  const s = { ...emptyState(), entries: [entry({ overrides: { blur: 3 } })] }
  let next = applyOp(s, { type: 'update-entry', id: 'a1', patch: { label: 'Sky', inRotation: false, overrides: { opacity: 0.5 } } })
  assert.deepEqual(next.entries[0], { ...entry(), label: 'Sky', inRotation: false, overrides: { opacity: 0.5 } })
  next = applyOp(next, { type: 'update-entry', id: 'a1', patch: { overrides: null } })
  assert.equal('overrides' in next.entries[0], false)
  next = applyOp(next, { type: 'update-entry', id: 'a1', patch: { label: '' } })
  assert.equal('label' in next.entries[0], false, 'empty label clears it')
})

test('applyOp set-active accepts known ids and null, ignores unknown', () => {
  const s = { ...emptyState(), entries: [entry()] }
  assert.equal(applyOp(s, { type: 'set-active', id: 'a1' }).activeId, 'a1')
  assert.equal(applyOp({ ...s, activeId: 'a1' }, { type: 'set-active', id: null }).activeId, null)
  assert.equal(applyOp(s, { type: 'set-active', id: 'nope' }).activeId, null)
})

test('applyOp set-appearance and set-rotation merge and clamp', () => {
  let s = applyOp(emptyState(), { type: 'set-appearance', patch: { opacity: 0.6, fit: 'tile' } })
  assert.deepEqual(s.appearance, { ...DEFAULT_APPEARANCE, opacity: 0.6, fit: 'tile' })
  s = applyOp(s, { type: 'set-rotation', patch: { enabled: true, intervalMin: 5000 } })
  assert.deepEqual(s.rotation, { enabled: true, intervalMin: 1440, order: 'shuffle' })
})

test('applyOp never mutates its input', () => {
  const s = { ...emptyState(), entries: [entry()] }
  const frozen = structuredClone(s)
  applyOp(s, { type: 'remove', id: 'a1' })
  applyOp(s, { type: 'set-appearance', patch: { blur: 4 } })
  assert.deepEqual(s, frozen)
})

test('normalizeOp accepts well-formed ops and rejects the rest', () => {
  assert.deepEqual(normalizeOp({ type: 'add', source: ' /x.png ', label: 'L' }), { type: 'add', source: '/x.png', label: 'L' })
  assert.deepEqual(normalizeOp({ type: 'set-active', id: null }), { type: 'set-active', id: null })
  assert.deepEqual(normalizeOp({ type: 'remove', id: 'a' }), { type: 'remove', id: 'a' })
  assert.equal(normalizeOp({ type: 'add', source: '   ' }), undefined)
  assert.equal(normalizeOp({ type: 'remove' }), undefined)
  assert.equal(normalizeOp({ type: 'explode' }), undefined)
  assert.equal(normalizeOp(null), undefined)
  assert.equal(normalizeOp({ type: 'set-appearance', patch: 'x' }), undefined)
})

test('newEntryId is 12 base36 chars and unique-ish', () => {
  const ids = new Set(Array.from({ length: 200 }, newEntryId))
  assert.equal(ids.size, 200)
  for (const id of ids) assert.match(id, /^[0-9a-z]{12}$/)
})
