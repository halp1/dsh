/**
 * Browser half without React: the enabling rule, the run flow's error
 * reporting, and the row mounting against sidebar-shaped DOM.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { buttonView } from '../src/client/view.ts'
import { installRowButtons, workspaceIdOf } from '../src/client/mount.ts'
import { createPushStore } from '../src/client/store.ts'
import { refreshStatus, runPush } from '../src/client/actions.ts'

const ahead = (id, n = 2) => ({ workspaceId: id, running: false, kind: 'ahead', ahead: n, branch: 'main' })

test('buttonView: enabled only with commits to push and nothing in flight', () => {
  assert.equal(buttonView({ status: ahead('w', 3), running: false }).enabled, true)
  assert.equal(buttonView({ status: ahead('w', 3), running: false }).count, 3)
  for (const state of [
    { status: undefined, running: false },
    { status: ahead('w'), running: true },
    { status: { workspaceId: 'w', running: false, kind: 'idle', reason: 'clean' }, running: false },
    { status: { workspaceId: 'w', running: false, kind: 'idle', reason: 'no-repo' }, running: false },
    { status: { workspaceId: 'w', running: false, kind: 'error', message: 'boom' }, running: false },
  ]) assert.equal(buttonView(state).enabled, false, JSON.stringify(state))
})

const json = (status, body) => ({ ok: status < 400, status, json: async () => body })

test('runPush: success, git failures, HTTP failures and network errors', async () => {
  const cases = [
    [async () => json(200, { ok: true, pulled: true, status: { kind: 'idle', reason: 'clean' } }), 'success', /Pushed/],
    [async () => json(200, { ok: false, step: 'pull', message: 'CONFLICT (content)' }), 'error', /git pull failed: CONFLICT/],
    [async () => json(200, { ok: false, step: 'push', message: 'rejected' }), 'error', /git push failed: rejected/],
    [async () => json(409, { ok: false, message: 'already running' }), 'error', /already running/],
    [async () => ({ ok: false, status: 502, json: async () => { throw new Error('html') } }), 'error', /HTTP 502/],
    [async () => { throw new TypeError('Failed to fetch') }, 'error', /Failed to fetch/],
  ]
  for (const [fetcher, tone, text] of cases) {
    const store = createPushStore()
    store.setAll([ahead('w1')])
    let sawRunning = false
    store.subscribe(() => { sawRunning ||= store.button('w1').running })
    await runPush(store, fetcher, 'w1')
    assert.equal(store.notice()?.tone, tone)
    assert.match(store.notice().text, text)
    assert.ok(sawRunning)
    assert.equal(store.button('w1').running, false)
  }

  const store = createPushStore()
  await runPush(store, async () => json(200, { ok: true, status: { kind: 'idle', reason: 'clean' } }), 'w1')
  assert.equal(buttonView(store.button('w1')).enabled, false, 'the returned status disables the button')
})

test('refreshStatus keeps unchanged button snapshots stable and drops removed workspaces', async () => {
  const store = createPushStore()
  assert.equal(await refreshStatus(store, async () => json(200, { workspaces: [ahead('w1'), ahead('w2')] })), true)
  const first = store.button('w1')
  let emits = 0
  store.subscribe(() => { emits++ })
  await refreshStatus(store, async () => json(200, { workspaces: [ahead('w1'), ahead('w2')] }))
  assert.equal(emits, 0)
  assert.equal(store.button('w1'), first)
  await refreshStatus(store, async () => json(200, { workspaces: [ahead('w1')] }))
  assert.equal(store.has('w2'), false)
  assert.equal(await refreshStatus(store, async () => json(500, {})), false)
})

/** One workspace header the way ui-workspace renders it. */
function row(doc, key, { trigger = true, nested } = {}) {
  const el = doc.createElement('div')
  el.setAttribute('data-row-key', key)
  const actions = doc.createElement('span')
  if (trigger) {
    const more = doc.createElement('button')
    more.setAttribute('data-context-menu-trigger', '')
    more.className = 'YDXeBa_iconButton'
    actions.append(more)
  }
  const add = doc.createElement('button')
  add.className = 'new-session'
  actions.append(add)
  el.append(actions)
  if (nested !== undefined) el.append(nested)
  return el
}

const order = (el) => [...el.querySelector('span').children].map(child => child.getAttribute('data-dshpush-host') ?? child.className)
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

test('installRowButtons: one button per workspace, between "..." and New Session, surviving re-renders', async () => {
  const { window } = new JSDOM('<div id="sidebar"></div>')
  Object.assign(globalThis, { MutationObserver: window.MutationObserver })
  const doc = window.document
  const sidebar = doc.getElementById('sidebar')
  const child = row(doc, 'workspace:child')
  const parent = row(doc, 'workspace:parent', { nested: child })
  sidebar.append(parent, row(doc, 'workspace:ungrouped', { trigger: false }), row(doc, 'session:s1'), row(doc, 'workspace:unknown'))

  const mounts = []
  const renderer = {
    mount(host, id, hostClass) {
      const entry = { id, hostClass, live: true }
      mounts.push(entry)
      return () => { entry.live = false }
    },
  }
  const known = new Set(['parent', 'child', 'ungrouped'])
  const rows = installRowButtons(sidebar, renderer, id => known.has(id))

  assert.deepEqual(mounts.map(m => m.id).sort(), ['child', 'parent'])
  assert.equal(mounts[0].hostClass, 'YDXeBa_iconButton')
  assert.deepEqual(order(parent), ['YDXeBa_iconButton', 'parent', 'new-session'])
  assert.deepEqual(order(child), ['YDXeBa_iconButton', 'child', 'new-session'])

  // React re-renders the strip and drops our node: it is put back without a remount.
  const strip = parent.querySelector('span')
  strip.replaceChildren(...[...strip.children].filter(el => !el.hasAttribute('data-dshpush-host')))
  await flush()
  assert.deepEqual(order(parent), ['YDXeBa_iconButton', 'parent', 'new-session'])
  assert.equal(mounts.length, 2)

  // A workspace becomes known later.
  known.add('unknown')
  rows.sync()
  await flush()
  assert.equal(mounts.length, 3)

  // A removed row unmounts its button.
  child.remove()
  await flush()
  assert.equal(mounts.find(m => m.id === 'child').live, false)

  rows.dispose()
  assert.ok(mounts.every(m => !m.live))
  assert.equal(sidebar.querySelector('[data-dshpush-host]'), null)
})

test('workspaceIdOf', () => {
  assert.equal(workspaceIdOf('workspace:abc'), 'abc')
  assert.equal(workspaceIdOf('workspace:'), undefined)
  assert.equal(workspaceIdOf('session:abc'), undefined)
  assert.equal(workspaceIdOf(null), undefined)
})
