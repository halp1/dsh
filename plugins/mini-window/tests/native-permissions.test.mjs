import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { installMicrophonePolicy } = require('../native/permissions.cjs')
const origin = 'http://127.0.0.1:3080'
function setup({ response = 0, osAllowed = true, platform = 'darwin' } = {}) {
  const calls = [], reports = []
  let request, check, enabled = true, visible = true
  const contents = { getURL: () => `${origin}/mini`, session: { setPermissionRequestHandler: value => { request = value }, setPermissionCheckHandler: value => { check = value } } }
  const window = { webContents: contents, isDestroyed: () => false, isVisible: () => visible }
  installMicrophonePolicy(window, origin, {
    dialog: { showMessageBox: async (_window, options) => { calls.push(['prompt', options.defaultId]); return { response } } },
    systemPreferences: { askForMediaAccess: async kind => { calls.push(['os', kind]); return osAllowed } },
    isEnabled: () => enabled, platform, report: value => reports.push(value),
  })
  const details = { isMainFrame:true, requestingUrl:`${origin}/mini`, mediaTypes:['audio'] }
  return {
    calls, reports, contents, details,
    request: (permission = 'media', changes = {}, sender = contents) => new Promise(resolve => request(sender, permission, resolve, { ...details, ...changes })),
    check: (changes = {}) => check(contents, 'media', origin, { ...details, mediaType:'audio', ...changes }),
    disable: () => { enabled = false }, hide: () => { visible = false },
  }
}
test('microphone requires native user confirmation plus OS consent, then allows only trusted main-frame audio', async () => {
  const peer = setup()
  assert.equal(peer.check(),false)
  assert.equal(await peer.request(),true)
  assert.deepEqual(peer.calls,[['prompt',1],['os','microphone']])
  assert.equal(peer.check(),true)
  assert.equal(peer.check({ mediaType:'video' }),false)
  assert.equal(peer.check({ isMainFrame:false }),false)
  assert.equal(peer.check({ requestingUrl:'https://evil.test' }),false)
  assert.equal(await peer.request(),true)
  assert.equal(peer.calls.length,2)
  peer.disable()
  assert.equal(peer.check(),false)
  assert.equal(await peer.request(),false)
})
test('camera, mixed/unknown media, other origins, hidden windows, subframes, and unrelated permissions cannot prompt or grant', async () => {
  const peer = setup()
  for (const details of [{ mediaTypes:['video'] },{ mediaTypes:['audio','video'] },{ mediaTypes:[] },{ mediaTypes:undefined },{ isMainFrame:false },{ requestingUrl:'https://evil.test' }]) assert.equal(await peer.request('media',details),false)
  assert.equal(await peer.request('notifications'),false)
  assert.equal(await peer.request('media',{},{}),false)
  peer.hide()
  assert.equal(await peer.request(),false)
  assert.deepEqual(peer.calls,[])
})
test('copy buttons may write the clipboard from the trusted renderer only; reads stay denied', async () => {
  const peer = setup()
  assert.equal(await peer.request('clipboard-sanitized-write'),true)
  assert.equal(await peer.request('clipboard-sanitized-write',{ requestingUrl:'https://evil.test' }),false)
  assert.equal(await peer.request('clipboard-sanitized-write',{},{}),false)
  assert.equal(await peer.request('clipboard-read'),false)
  assert.deepEqual(peer.calls,[])
})
test('microphone confirmation defaults to deny, cancellation and macOS rejection are respected', async () => {
  const cancelled = setup({ response:1 })
  assert.equal(await cancelled.request(),false)
  assert.deepEqual(cancelled.calls,[['prompt',1]])
  const rejected = setup({ osAllowed:false })
  assert.equal(await rejected.request(),false)
  assert.match(rejected.reports[0],/macOS/)
  assert.equal(rejected.check(),false)
  const linux = setup({ platform:'linux' })
  assert.equal(await linux.request(),true)
  assert.deepEqual(linux.calls,[['prompt',1]])
})
