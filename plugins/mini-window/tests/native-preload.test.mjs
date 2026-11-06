import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../native/preload.cjs', import.meta.url), 'utf8')
function setup() {
  const events = new Map(), domEvents = new Map(), calls = []
  let bridge
  vm.runInNewContext(source, {
    require(name) {
      assert.equal(name, 'electron')
      return {
        contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, 'dshMiniWindow'); bridge = api } },
        ipcRenderer: { on: (channel, callback) => events.set(channel, callback), invoke: (channel, ...args) => { calls.push([channel, ...args]); return Promise.resolve({ expanded: true, visible: false }) } },
      }
    },
    window: { location: { origin: 'http://127.0.0.1:3080' }, addEventListener: (type, handler) => domEvents.set(type, handler) },
    URL,
  })
  return { bridge, events, domEvents, calls }
}
test('preload exposes only the versioned narrow bridge and validates expansion', async () => {
  const { bridge, calls } = setup()
  assert.deepEqual(Object.keys(bridge).sort(), ['drag', 'getState', 'hide', 'onCommand', 'onState', 'setExpanded', 'version'].sort())
  assert.equal(bridge.version, 1)
  await bridge.hide()
  await bridge.setExpanded(true)
  const state = await bridge.getState()
  assert.equal(state.expanded, true)
  assert.equal(state.visible, false)
  await assert.rejects(bridge.setExpanded('yes'), /boolean/)
  await bridge.drag('start'); await bridge.drag('end')
  await assert.rejects(bridge.drag('move'), /start or end/)
  assert.deepEqual(calls, [['dsh-mini:hide'], ['dsh-mini:set-expanded', true], ['dsh-mini:get-state'], ['dsh-mini:drag', 'start'], ['dsh-mini:drag', 'end']])
})
test('state and command subscriptions validate, replay, unsubscribe, and isolate listener errors', () => {
  const { bridge, events } = setup()
  const states = [], commands = []
  assert.throws(() => bridge.onState(null), /listener/)
  events.get('dsh-mini:state')({}, { expanded: true, visible: false, ignored: 'secret' })
  const unsubState = bridge.onState(value => states.push(value))
  assert.deepEqual(Object.keys(states[0]).sort(), ['expanded', 'visible'])
  bridge.onState(() => { throw new Error('listener') })
  events.get('dsh-mini:state')({}, { expanded: false, visible: true })
  events.get('dsh-mini:state')({}, { expanded: 'bad', visible: true })
  assert.equal(states.length, 2)
  unsubState()
  events.get('dsh-mini:state')({}, { expanded: false, visible: false })
  assert.equal(states.length, 2)
  events.get('dsh-mini:command')({}, 'new-chat')
  events.get('dsh-mini:command')({}, 'unsafe-command')
  const unsubCommand = bridge.onCommand(command => commands.push(command))
  assert.deepEqual(commands, ['new-chat'])
  events.get('dsh-mini:command')({}, 'open-settings')
  unsubCommand()
  events.get('dsh-mini:command')({}, 'new-chat')
  assert.deepEqual(commands, ['new-chat', 'open-settings'])
})
test('external links require real clicked HTTP(S) anchors, never synthetic events or downloads', () => {
  const { domEvents, calls } = setup()
  const trigger = (url, extra = {}) => {
    let prevented = false
    const anchor = { tagName: 'A', href: url, hasAttribute: () => Boolean(extra.download) }
    domEvents.get(extra.type || 'click')({ type: 'click', isTrusted: true, defaultPrevented: false, button: 0, composedPath: () => [anchor], preventDefault: () => { prevented = true }, ...extra })
    return prevented
  }
  for (const [url, extra] of [
    ['https://example.org', { isTrusted: false }],
    ['https://example.org', { download: true }],
    ['https://example.org', { defaultPrevented: true }],
    ['https://example.org', { button: 2 }],
    ['http://127.0.0.1:3080/chat', {}],
    ['javascript:alert(1)', {}],
    ['file:///tmp/local', {}],
    ['https://user:pass@example.org', {}],
  ]) assert.equal(trigger(url, extra), false)
  assert.equal(trigger('https://example.org/docs'), true)
  assert.equal(trigger('https://example.org/other', { type: 'auxclick', button: 1 }), true)
  assert.deepEqual(calls, [['dsh-mini:open-external', 'https://example.org/docs'], ['dsh-mini:open-external', 'https://example.org/other']])
})
