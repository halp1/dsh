import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createStateClient } from '../src/client/state-client.ts'
import { applyOp, emptyState } from '../src/shared/state.ts'

// DSH publishes primitives as a browser module factory. Use native controls at
// that external boundary while exercising the real settings component/client.
const icon = () => null
mock.module('@deepseek-ai/dsh-client-ui-primitives', { namedExports: {
  Button: ({ variant, size, ...props }) => React.createElement('button', props),
  Input: (props) => React.createElement('input', props),
  SegmentedControl: () => null,
  Switch: ({ checked, label, onChange }) => React.createElement('input', { type: 'checkbox', checked, 'aria-label': label, onChange: (e) => onChange(e.target.checked) }),
  IconCheckOutlineMedium: icon,
  IconCloseOutlineMedium: icon,
  IconEditOutlineMedium: icon,
  IconFolderCloseMedium: icon,
  IconRefreshOutlineMedium: icon,
  IconTrashOutlineMedium: icon,
  IconWarningOutlineMedium: icon,
} })
const { BackgroundTab } = await import('../src/client/settings-tab.tsx')

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('folder selection cannot remove a shared entry and deletion requires a separate confirmation', async (t) => {
  const dom = new JSDOM('<body><div id="root"></div></body>', { url: 'https://dsh.haelp.dev/pair-app' })
  const old = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT, observer: globalThis.IntersectionObserver }
  let intersect
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: class {
      constructor(callback) { intersect = callback }
      observe() {}
      disconnect() {}
    },
  })
  const imageFetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'api/dsh-background.file?entry=folder&i=0')
    assert.equal(new Headers(init.headers).get('accept'), 'image/*')
    return new Response('image', { headers: { 'content-type': 'image/png' } })
  })
  const folder = { id: 'folder', kind: 'folder', source: '/host/backgrounds', inRotation: true }
  let state = { ...emptyState(), entries: [folder] }
  const ops = []
  const client = createStateClient(async (_url, init) => {
    if (init.method === 'POST') {
      const { op } = JSON.parse(init.body)
      ops.push(op)
      state = applyOp(state, op)
    }
    return new Response(JSON.stringify({ state, folders: { folder: { count: 2 } }, files: {} }))
  })
  const root = createRoot(dom.window.document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    Object.assign(globalThis, { window: old.window, document: old.document, IS_REACT_ACT_ENVIRONMENT: old.act, IntersectionObserver: old.observer })
    dom.window.close()
  })
  await act(async () => {
    root.render(React.createElement(BackgroundTab, { client, close() {} }))
    await flush()
  })
  const select = dom.window.document.querySelector('button.dshbg-select')
  const remove = dom.window.document.querySelector('button[aria-label="Remove backgrounds"]')
  assert.ok(select)
  assert.ok(remove)
  assert.equal(select.contains(remove), false, 'destructive controls are outside the selection hit target')
  assert.equal(imageFetch.mock.callCount(), 0, 'offscreen thumbnails do not download the original images')
  await act(async () => { intersect([{ isIntersecting: false }]); await flush() })
  assert.equal(imageFetch.mock.callCount(), 0)
  await act(async () => { intersect([{ isIntersecting: true }]); intersect([{ isIntersecting: true }]); await flush() })
  assert.match(select.querySelector('img').src, /^blob:/, 'thumbnail uses authenticated image bytes')
  assert.equal(imageFetch.mock.callCount(), 1)
  const thumbnail = select.querySelector('img').src

  await act(async () => { select.click(); await flush() })
  assert.deepEqual(ops, [{ type: 'set-active', id: 'folder' }])
  assert.equal(client.getSnapshot().state.entries.length, 1)
  assert.equal(select.getAttribute('aria-pressed'), 'true')

  await act(async () => remove.click())
  assert.equal(ops.length, 1, 'opening confirmation is not a global mutation')
  const button = (text) => [...dom.window.document.querySelectorAll('button')].find((el) => el.textContent === text)
  await act(async () => button('Cancel').click())
  assert.equal(client.getSnapshot().state.entries.length, 1)
  await act(async () => remove.click())
  await act(async () => { dom.window.document.querySelector('button[aria-label="Confirm removal of backgrounds"]').click(); await flush() })
  assert.deepEqual(ops.at(-1), { type: 'remove', id: 'folder' })
  assert.equal(client.getSnapshot().state.entries.length, 0)
  imageFetch.mock.restore()
  await assert.rejects(fetch(thumbnail), 'removing the tile releases its thumbnail blob')
})
