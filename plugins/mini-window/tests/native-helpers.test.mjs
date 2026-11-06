import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { clampBounds, initialBounds, boundsForMode, geometryPatch } from '../native/geometry.mjs'
import { replaceShortcut } from '../native/shortcut.mjs'
import { defaultState } from '../shared/state.mjs'
const require = createRequire(import.meta.url)
const { originOf, isTrustedURL, isTrustedSender, externalURL, localCommand } = require('../native/security.cjs')

const area = { x: 0, y: 25, width: 1440, height: 875 }
test('compact defaults and expanded defaults respect work areas', () => {
  const state = defaultState()
  assert.deepEqual(initialBounds(state, area), { x: 400, y: 764, width: 640, height: 112 })
  assert.deepEqual(initialBounds({ ...state, expanded: true }, area), { x: 400, y: 276, width: 640, height: 600 })
  assert.deepEqual(initialBounds({ ...state, expanded: true, expandedBounds: { x: 50, y: 30, width: 900, height: 800 } }, area), { x: 50, y: 30, width: 900, height: 800 })
})
test('clamping handles disconnected, negative-origin, oversized, and small screens', () => {
  assert.deepEqual(clampBounds({ x: 9000, y: -2000, width: 640, height: 600 }, area), { x: 800, y: 25, width: 640, height: 600 })
  assert.deepEqual(clampBounds({ x: 0, y: 100, width: 1800, height: 1200 }, { x: -1280, y: -20, width: 1280, height: 720 }), { x: -1280, y: -20, width: 1280, height: 720 })
  assert.deepEqual(boundsForMode({ x: 100, y: 100 }, null, true, { x: 0, y: 0, width: 320, height: 240 }), { x: 0, y: 0, width: 320, height: 240 })
  assert.throws(() => clampBounds({}, area), /bounds/)
  assert.throws(() => clampBounds({ x: 0, y: 0, width: 640, height: 112 }, {}), /work area/)
})
test('expanded geometry survives collapse, compact move, and reopen', () => {
  const expanded = { x: 40, y: 50, width: 850, height: 700 }
  const collapsed = boundsForMode(expanded, expanded, false, area)
  assert.deepEqual(collapsed, { x: 40, y: 50, width: 640, height: 112 })
  const patch = geometryPatch({ ...collapsed, x: 100, y: 120 }, expanded, false)
  assert.deepEqual(patch.expandedBounds, { x: 100, y: 120, width: 850, height: 700 })
  assert.deepEqual(boundsForMode(patch.bounds, patch.expandedBounds, true, area), patch.expandedBounds)
  assert.deepEqual(geometryPatch(expanded, null, true).expandedBounds, expanded)
  assert.deepEqual(boundsForMode(expanded, { ...expanded, width: 200, height: 100 }, true, area), { x: 40, y: 50, width: 440, height: 360 })
})
function registry({ fail = false, throws = false } = {}) {
  const calls = []
  return { calls, register: (key, callback) => { calls.push(['register', key]); assert.equal(typeof callback, 'function'); if (throws) throw new Error('OS failure'); return !fail }, unregister: key => calls.push(['unregister', key]) }
}
test('shortcut swap registers first, leaves old shortcut on OS refusal, disables cleanly', () => {
  const good = registry()
  assert.deepEqual(replaceShortcut(good, 'Command+Shift+Space', 'Command+Shift+J', () => {}), { ok: true, activeShortcut: 'Command+Shift+J', shortcutRegistered: true })
  assert.deepEqual(good.calls, [['register', 'Command+Shift+J'], ['unregister', 'Command+Shift+Space']])
  for (const options of [{ fail: true }, { throws: true }]) {
    const bad = registry(options)
    const result = replaceShortcut(bad, 'Command+Shift+Space', 'Command+Shift+J', () => {})
    assert.equal(result.ok, false)
    assert.equal(result.activeShortcut, 'Command+Shift+Space')
    assert.equal(result.shortcutRegistered, true)
    assert.equal(bad.calls.length, 1)
    assert.match(result.error, /Settings/)
  }
  const disabled = registry()
  assert.equal(replaceShortcut(disabled, 'Command+Shift+Space', null, () => {}).shortcutRegistered, false)
  assert.deepEqual(disabled.calls, [['unregister', 'Command+Shift+Space']])
  const same = registry()
  replaceShortcut(same, 'Command+Shift+Space', 'Command+Shift+Space', () => {})
  assert.deepEqual(same.calls, [])
})
test('trust requires exact HTTP(S) origin and the same main frame', () => {
  const origin = 'http://127.0.0.1:3080'
  assert.equal(originOf(`${origin}/?token=secret`), origin)
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://user:password@127.0.0.1:3080', 'not a url', ['http://127.0.0.1:3080'], {}]) assert.equal(originOf(url), null)
  assert.equal(isTrustedURL(`${origin}/login?next=mini`, origin), true)
  for (const url of ['http://localhost:3080', 'https://127.0.0.1:3080', 'http://127.0.0.1:3081', 'http://127.0.0.1:3080.evil.test']) assert.equal(isTrustedURL(url, origin), false)
  const frame = { url: `${origin}/mini` }
  const contents = { mainFrame: frame }
  const window = { webContents: contents, isDestroyed: () => false }
  assert.equal(isTrustedSender({ sender: contents, senderFrame: frame }, window, origin), true)
  assert.equal(isTrustedSender({ sender: contents, senderFrame: { url: frame.url } }, window, origin), false)
  assert.equal(isTrustedSender({ sender: {}, senderFrame: frame }, window, origin), false)
  frame.url = 'https://evil.test'
  assert.equal(isTrustedSender({ sender: contents, senderFrame: frame }, window, origin), false)
  assert.equal(externalURL('https://example.org/docs', origin), 'https://example.org/docs')
  for (const url of [`${origin}/settings`, 'javascript:alert(1)', 'file:///tmp/file', 'https://user:pass@example.org']) assert.equal(externalURL(url, origin), null)
})
test('CmdN and CmdW are local, keydown-only, and Escape is untouched', () => {
  const key = { type: 'keyDown', meta: true, control: false, key: 'N' }
  assert.equal(localCommand(key, 'darwin'), 'new-chat')
  assert.equal(localCommand({ ...key, key: 'w' }, 'darwin'), 'hide')
  assert.equal(localCommand({ ...key, isAutoRepeat: true }, 'darwin'), 'new-chat')
  for (const extra of [{ key: 'Escape' }, { shift: true }, { alt: true }, { control: true }, { type: 'keyUp' }, { meta: false }]) assert.equal(localCommand({ ...key, ...extra }, 'darwin'), null)
  assert.equal(localCommand({ ...key, meta: false, control: true }, 'linux'), 'new-chat')
})
