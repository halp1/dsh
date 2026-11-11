import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { bindSendHook } from '../src/client/send-hook.ts'

/** The composer's trailing group as InputBar renders it. */
function composer() {
  const dom = new JSDOM(`<body><div id="root"><div class="trailing">
    <div class="standardControls"><span id="anchor"></span><button id="model">model</button></div>
    <button id="send" class="uV2eYG_primary" aria-busy="false">send</button>
  </div></div></body>`)
  const doc = dom.window.document
  const opened = []
  const reached = []
  // React delegates from the root in the bubble phase.
  doc.getElementById('root').addEventListener('click', (e) => reached.push(`click:${e.target.id}`))
  doc.getElementById('root').addEventListener('contextmenu', (e) => reached.push(`contextmenu:${e.target.id}`))
  let canOpen = true
  const unbind = bindSendHook(doc.getElementById('anchor'), { canOpen: () => canOpen, open: (b) => opened.push(b.id) }, doc)
  const fire = (id, type, init = {}) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'contextmenu' ? 2 : 0, ...init })
    doc.getElementById(id).dispatchEvent(event)
    return event
  }
  return { doc, opened, reached, fire, unbind, setCanOpen: (v) => { canOpen = v } }
}

test('shift click and right click on Send open the scheduler and never reach React', () => {
  const c = composer()
  assert.equal(c.fire('send', 'click', { shiftKey: true }).defaultPrevented, true)
  assert.equal(c.fire('send', 'contextmenu').defaultPrevented, true)
  assert.deepEqual(c.opened, ['send', 'send'])
  assert.deepEqual(c.reached, [])
})

test('plain clicks, other buttons, a disabled Send, and an unschedulable draft pass through', () => {
  const c = composer()
  c.fire('send', 'click')
  c.fire('model', 'click', { shiftKey: true })
  c.fire('model', 'contextmenu')
  c.setCanOpen(false)
  c.fire('send', 'contextmenu')
  c.setCanOpen(true)
  c.doc.getElementById('send').disabled = true
  c.fire('send', 'contextmenu')
  assert.deepEqual(c.opened, [])
  assert.deepEqual(c.reached, ['click:send', 'click:model', 'contextmenu:model', 'contextmenu:send', 'contextmenu:send'])
})

test('a re-rendered Send button is still found, and unbinding restores the default', () => {
  const c = composer()
  const old = c.doc.getElementById('send')
  const fresh = old.cloneNode(true)
  old.replaceWith(fresh)
  c.fire('send', 'contextmenu')
  assert.deepEqual(c.opened, ['send'])
  c.unbind()
  c.fire('send', 'contextmenu')
  assert.deepEqual(c.opened, ['send'])
  assert.deepEqual(c.reached, ['contextmenu:send'])
})
