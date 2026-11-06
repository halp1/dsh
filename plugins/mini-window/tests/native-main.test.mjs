import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Execute the real CJS entry point against a tiny Electron model. No Electron binary/display is needed.
const harness = String.raw`
const { EventEmitter } = require('node:events')
const Module = require('node:module')
const calls = { registrations: [], unregistrations: [], commands: [], windows: 0, cleaned: false, urls: 0, shows: 0 }
const handlers = new Map(), menuActions = new Map()
let window, releaseLoad
const app = new EventEmitter()
Object.assign(app, { commandLine: { appendSwitch: value => { calls.logSwitch = value } }, setPath: () => {}, setName: () => {}, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), setActivationPolicy: () => {}, dock: { hide() {} }, quit: () => { app.emit('before-quit'); setImmediate(() => process.exit(0)) } })
class BrowserWindow extends EventEmitter {
  constructor(options) {
    super(); window = this; calls.windows++; this.options = options; this.bounds = Object.fromEntries(['x','y','width','height'].map(k => [k,options[k]])); this.visible = false; this.resizable = options.resizable
    const contents = new EventEmitter()
    contents.mainFrame = { url: '' }; contents.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }
    contents.getURL = () => contents.mainFrame.url
    contents.send = (channel, value) => { if (channel === 'dsh-mini:command') calls.commands.push(value) }
    contents.setWindowOpenHandler = handler => { contents.popupHandler = handler }
    this.webContents = contents
  }
  isDestroyed() { return false }
  isVisible() { return this.visible }
  getBounds() { return { ...this.bounds } }
  setBounds(bounds) { this.bounds = { ...bounds }; this.emit('resize') }
  getPosition() { return [this.bounds.x, this.bounds.y] }
  setPosition(x,y) { this.bounds = { ...this.bounds, x, y }; this.emit('move') }
  setMinimumSize(width,height) { this.minimum = [width,height] }
  setResizable(value) { this.resizable = value }
  setTitle(value) { this.title = value }
  setAlwaysOnTop(value,level) { this.top = [value,level] }
  setVisibleOnAllWorkspaces(value,options) { this.workspaces = [value,options] }
  loadURL(url) {
    calls.urls++; this.webContents.mainFrame.url = url
    if (process.env.FAIL_LOAD === '1' && calls.urls === 1) { process.emitWarning('NEVER_PRINT_THIS_TOKEN'); this.webContents.emit('did-fail-load',{},-102,'Failed',url,true); return Promise.reject(new Error('NEVER_PRINT_THIS_TOKEN')) }
    if (process.env.DELAY_LOAD === '1' && calls.urls === 1) return new Promise(resolve => { releaseLoad = () => { this.webContents.emit('did-finish-load'); resolve(); releaseLoad = null } })
    this.webContents.emit('did-finish-load'); return Promise.resolve()
  }
  show() { calls.shows++; this.visible = true; this.emit('show') }
  hide() { this.visible = false; this.emit('hide') }
  focus() { calls.focused = true }
}
const screen = new EventEmitter()
const display = { workArea: { x:0, y:25, width:1440, height:875 } }
screen.getPrimaryDisplay = screen.getDisplayMatching = () => { calls.matchingDisplay = true; return display }
let cursor = { x:100,y:100 }
screen.getCursorScreenPoint = () => ({ ...cursor })
screen.getDisplayNearestPoint = () => { calls.nearestDisplay = true; return display }
const electron = {
  app, BrowserWindow, screen,
  Menu: { buildFromTemplate: value => value, setApplicationMenu: value => { calls.menu = value.map(item => item.label); for (const item of value) for (const action of item.submenu || []) if (action.click) menuActions.set(action.label,action.click) } },
  nativeImage: { createFromDataURL: () => ({ isEmpty: () => true }), createFromBitmap: () => ({ isEmpty: () => false, setTemplateImage() {} }) },
  Tray: class extends EventEmitter { constructor() { super(); calls.tray = true } setToolTip() {} setContextMenu(value) { calls.trayMenu = value.filter(item => item.label).map(item => item.label) } destroy() { calls.trayDestroyed = true } },
  globalShortcut: { register: (key,callback) => { calls.registrations.push(key); if (process.env.FAIL_INITIAL === '1' || key === 'Command+Shift+J') return false; calls.shortcut = callback; return true }, unregister: key => calls.unregistrations.push(key), unregisterAll: () => { calls.cleaned = true } },
  ipcMain: { handle: (channel,handler) => handlers.set(channel,handler), removeHandler: channel => handlers.delete(channel) },
  shell: { openExternal: async url => { calls.external = url } },
  dialog: { showMessageBox: async () => ({ response:1 }) }, systemPreferences: { askForMediaAccess: async () => false },
}
const load = Module._load
Module._load = function(name, ...args) { return name === 'electron' ? electron : load.call(this,name,...args) }
process.on('message', async message => {
  try {
    let result
    if (message.action === 'inspect') result = { ...calls, window: window && { bounds: window.getBounds(), resizable: window.resizable, visible: window.visible, minimum: window.minimum, top: window.top, title: window.title, workspaces: window.workspaces, options: window.options } }
    else if (message.action === 'ipc') {
      const frame = message.untrusted ? { url: 'https://evil.test' } : window.webContents.mainFrame
      result = await handlers.get(message.channel)({ sender: window.webContents, senderFrame: frame },message.value)
    } else if (message.action === 'page-title') {
      let prevented = false
      window.webContents.emit('page-title-updated',{ preventDefault: () => { prevented = true } },message.value)
      result = { prevented, title: window.title }
    } else if (message.action === 'input') {
      let prevented = false
      window.webContents.emit('before-input-event',{ preventDefault: () => { prevented = true } },message.value)
      result = { prevented }
    } else if (message.action === 'navigation') {
      let prevented = false
      const event = { url:message.url, preventDefault: () => { prevented = true } }
      window.webContents.emit(message.event || 'will-navigate',event,message.url)
      result = { prevented, popup: window.webContents.popupHandler({ url:message.url }).action }
    } else if (message.action === 'display') { Object.assign(display.workArea,message.area); screen.emit('display-metrics-changed'); result = true }
    else if (message.action === 'cursor') { cursor = { ...message.point }; result = true }
    else if (message.action === 'toggle') { calls.shortcut(); result = true }
    else if (message.action === 'release-load') { releaseLoad(); result = true }
    else if (message.action === 'menu') { menuActions.get(message.label)(); result = true }
    process.send({ seq:message.seq, ok:true, result })
  } catch(error) { process.send({ seq:message.seq, ok:false, error:error.message }) }
})
require(process.argv[1])
`
async function companion(t, settings = {}, environment = {}) {
  const profile = await mkdtemp(path.join(tmpdir(), 'dsh-native-test-'))
  const child = spawn(process.execPath, ['-e', harness, fileURLToPath(new URL('../native/main.cjs', import.meta.url))], { stdio: ['pipe','pipe','pipe','ipc'], env: { ...process.env, ...environment } })
  const output = [], controls = [], pending = new Set()
  let raw = '', stderr = '', remainder = '', sequence = 0
  const notify = () => { for (const waiter of [...pending]) waiter() }
  child.stdout.on('data', chunk => {
    raw += chunk; remainder += chunk
    let end
    while ((end = remainder.indexOf('\n')) !== -1) { output.push(JSON.parse(remainder.slice(0,end))); remainder = remainder.slice(end+1) }
    notify()
  })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('message', message => { controls.push(message); notify() })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const wait = (items, predicate) => new Promise((resolve,reject) => {
    const timer = setTimeout(() => { pending.delete(check); reject(new Error('Timed out waiting for native protocol; stderr: ' + stderr)) },5000)
    const check = () => { const value = items.find(predicate); if (value) { clearTimeout(timer); pending.delete(check); resolve(value) } }
    pending.add(check); check()
  })
  const command = async (command, settings) => { const id = ++sequence; child.stdin.write(JSON.stringify({ id, command, settings })+'\n'); return wait(output,value => value.type === 'response' && value.id === id) }
  const control = async message => { const seq = ++sequence; child.send({ ...message, seq }); return wait(controls,value => value.seq === seq) }
  t.after(async () => {
    if (child.exitCode === null) child.stdin.end()
    const timer = setTimeout(() => child.kill('SIGKILL'),2000)
    await exited; clearTimeout(timer)
    // The resolved temporary directory is owned by this test, not a computed user path.
    assert.ok(profile.startsWith(path.join(tmpdir(), 'dsh-native-test-')))
    await rm(profile,{ recursive:true, force:true })
    assert.equal(raw.includes('NEVER_PRINT_THIS_TOKEN'),false)
    assert.equal(stderr.includes('NEVER_PRINT_THIS_TOKEN'),false)
  })
  child.stdin.write(JSON.stringify({ type:'bootstrap', url:'http://127.0.0.1:3080/?token=NEVER_PRINT_THIS_TOKEN', userDataDir:profile, settings })+'\n')
  const ready = await wait(output,value => value.type === 'ready')
  return { child, command, control, ready, output, exited, waitOutput: predicate => wait(output,predicate) }
}

test('native startup preloads hidden renderer, then shows the prepared window', async t => {
  const peer = await companion(t)
  assert.deepEqual(peer.ready.runtime,{ status:'ready', visible:false, expanded:false, shortcutRegistered:true })
  await peer.waitOutput(value => value.type === 'geometry')
  const prepared = (await peer.control({ action:'inspect' })).result
  assert.equal(prepared.windows,1)
  assert.equal(prepared.window.visible,false)
  assert.equal(prepared.urls,1)
  assert.equal((await peer.command('show')).ok,true)
  const inspection = (await peer.control({ action:'inspect' })).result
  assert.equal(inspection.windows,1)
  assert.equal(inspection.urls,1)
  assert.equal(inspection.window.visible,true)
  assert.equal(inspection.window.resizable,false)
  assert.deepEqual(inspection.window.bounds,{ x:400,y:764,width:640,height:112 })
  assert.equal(inspection.nearestDisplay,true)
  assert.equal(inspection.logSwitch,'disable-logging')
  assert.deepEqual(inspection.window.top,[true,'floating'])
  assert.deepEqual(inspection.window.workspaces,[true,{ visibleOnFullScreen:true }])
  const preferences = inspection.window.options.webPreferences
  assert.equal(preferences.nodeIntegration,false)
  assert.equal(preferences.contextIsolation,true)
  assert.equal(preferences.sandbox,true)
  assert.equal(preferences.webSecurity,true)
  assert.equal(inspection.window.options.fullscreenable,false)
  assert.equal(inspection.window.options.hasShadow,false)
  assert.notEqual(inspection.window.options.roundedCorners,false)
  assert.equal(inspection.tray,undefined)
  assert.equal(inspection.window.options.frame,false)
  assert.equal(inspection.window.options.type,process.platform === 'darwin' ? 'panel' : undefined)
  assert.deepEqual((await peer.control({ action:'page-title',value:'DeepSeek Harness' })).result,{ prevented:true,title:'DSH Mini' })
  await peer.command('hide')
  await peer.command('show')
  assert.equal((await peer.control({ action:'inspect' })).result.windows,1)
})
test('protocol hide cancels an in-flight first show before the load completes', async t => {
  const peer = await companion(t,{}, { DELAY_LOAD:'1' })
  const showing = peer.command('show')
  await peer.waitOutput(value => value.type === 'geometry')
  assert.equal((await peer.command('hide')).result.visible,false)
  await peer.control({ action:'release-load' })
  assert.equal((await showing).result.visible,false)
  const inspection = (await peer.control({ action:'inspect' })).result
  assert.equal(inspection.window.visible,false)
  assert.equal(inspection.shows,0)
  assert.equal((await peer.command('show')).result.visible,true)
})
test('second global toggle cancels pending show intent instead of starting another late show', async t => {
  const peer = await companion(t,{}, { DELAY_LOAD:'1' })
  await peer.control({ action:'toggle' })
  await peer.waitOutput(value => value.type === 'geometry')
  await peer.control({ action:'toggle' })
  await peer.control({ action:'release-load' })
  const inspection = (await peer.control({ action:'inspect' })).result
  assert.equal(inspection.window.visible,false)
  assert.equal(inspection.shows,0)
  await peer.control({ action:'toggle' })
  assert.equal((await peer.control({ action:'inspect' })).result.window.visible,true)
})
for (const label of ['New Chat','Settings…']) test(`cancelled pending ${label} does not send its native command after load`, async t => {
  const peer = await companion(t,{}, { DELAY_LOAD:'1' })
  await peer.control({ action:'menu', label })
  await peer.waitOutput(value => value.type === 'geometry')
  await peer.command('hide')
  await peer.control({ action:'release-load' })
  const inspection = (await peer.control({ action:'inspect' })).result
  assert.equal(inspection.shows,0)
  assert.deepEqual(inspection.commands,[])
})
test('disable invalidates an in-flight show even if re-enabled before load completes', async t => {
  const peer = await companion(t,{}, { DELAY_LOAD:'1' })
  const showing = peer.command('show')
  await peer.waitOutput(value => value.type === 'geometry')
  await peer.command('configure',{ enabled:false })
  await peer.command('configure',{ enabled:true })
  await peer.control({ action:'release-load' })
  assert.equal((await showing).result.visible,false)
  assert.equal((await peer.control({ action:'inspect' })).result.shows,0)
})
test('quit during first load responds and exits without waiting for load completion', async t => {
  const peer = await companion(t,{}, { DELAY_LOAD:'1' })
  await peer.control({ action:'toggle' })
  await peer.waitOutput(value => value.type === 'geometry')
  assert.equal((await peer.command('quit')).ok,true)
  assert.equal((await peer.exited).code,0)
  assert.equal(peer.output.some(value => value.runtime?.visible),false)
})
test('native expansion and collapse retain expanded size, while compact windows cannot resize', async t => {
  const peer = await companion(t,{ expanded:false, bounds:{ x:50,y:50,width:640,height:112 }, expandedBounds:{ x:50,y:50,width:900,height:700 } })
  await peer.command('show')
  assert.equal((await peer.control({ action:'ipc', channel:'dsh-mini:set-expanded', value:true })).ok,true)
  let win = (await peer.control({ action:'inspect' })).result.window
  assert.equal(win.resizable,true)
  assert.deepEqual(win.bounds,{ x:50,y:50,width:900,height:700 })
  assert.deepEqual(win.minimum,[440,360])
  await peer.control({ action:'ipc', channel:'dsh-mini:set-expanded', value:false })
  win = (await peer.control({ action:'inspect' })).result.window
  assert.equal(win.resizable,false)
  assert.equal(win.bounds.height,112)
  await peer.command('hide'); await peer.command('show')
  await peer.control({ action:'ipc', channel:'dsh-mini:set-expanded', value:true })
  assert.deepEqual((await peer.control({ action:'inspect' })).result.window.bounds,{ x:50,y:50,width:900,height:700 })
  assert.ok(peer.output.some(value => value.type === 'geometry' && value.patch.expandedBounds.width === 900 && value.patch.expanded === false))
  await peer.control({ action:'display', area:{ x:-800,y:0,width:800,height:600 } })
  // Screen handler runs a Promise microtask; IPC inspection follows on the next event-loop turn.
  assert.deepEqual((await peer.control({ action:'inspect' })).result.window.bounds,{ x:-800,y:0,width:800,height:600 })
})
test('native menu expands the clean compact pill without needing an external toolbar', async t => {
  const peer = await companion(t,{ expanded:false })
  await peer.command('show')
  await peer.control({ action:'menu', label:'Expand Window' })
  let win = (await peer.control({ action:'inspect' })).result.window
  assert.equal(win.resizable,true); assert.equal(win.bounds.height,600)
  await peer.control({ action:'menu', label:'Collapse Window' })
  win = (await peer.control({ action:'inspect' })).result.window
  assert.equal(win.resizable,false); assert.equal(win.bounds.height,112)
})
test('native configure is transactional on shortcut failure, disable hides/unregisters, quit flushes its response', async t => {
  const peer = await companion(t)
  await peer.command('show')
  const failed = await peer.command('configure',{ shortcut:'Command+Shift+J' })
  assert.equal(failed.ok,false)
  assert.match(failed.error,/unavailable/)
  let inspection = (await peer.control({ action:'inspect' })).result
  assert.deepEqual(inspection.unregistrations,[])
  assert.equal(inspection.window.visible,true)
  assert.equal((await peer.command('configure',{ enabled:false })).result.shortcutRegistered,false)
  inspection = (await peer.control({ action:'inspect' })).result
  assert.deepEqual(inspection.unregistrations,['Command+Shift+Space'])
  assert.equal(inspection.window.visible,false)
  assert.equal((await peer.command('show')).ok,false)
  const response = await peer.command('quit')
  assert.equal(response.ok,true)
  assert.equal((await peer.exited).code,0)
})
test('startup shortcut refusal is useful status, not fatal, and show still works', async t => {
  const peer = await companion(t,{}, { FAIL_INITIAL:'1' })
  assert.equal(peer.ready.runtime.shortcutRegistered,false)
  assert.match(peer.ready.runtime.error,/unavailable/)
  assert.equal((await peer.control({ action:'inspect' })).result.tray,undefined)
  assert.equal((await peer.command('show')).ok,true)
})
test('a failed authenticated load is retried on the next show without leaking warning/error tokens', async t => {
  const peer = await companion(t,{}, { FAIL_LOAD:'1' })
  // Startup preloads and may consume the initial failure before the first show.
  await peer.waitOutput(value => value.type === 'status' && /retry/.test(value.runtime?.error || ''))
  assert.equal((await peer.control({ action:'inspect' })).result.urls,1)
  const shown = await peer.command('show')
  assert.equal(shown.ok,true)
  assert.equal(shown.result.error,undefined)
  assert.equal((await peer.control({ action:'inspect' })).result.urls,2)
})
test('title-bar drag follows the cursor until released, and rejects untrusted or malformed phases', async t => {
  const peer = await companion(t)
  await peer.command('show')
  const start = (await peer.control({ action:'inspect' })).result.window.bounds
  await peer.control({ action:'cursor', point:{ x:start.x + 20, y:start.y + 10 } })
  assert.equal((await peer.control({ action:'ipc', channel:'dsh-mini:drag', value:'start', untrusted:true })).ok,false)
  assert.equal((await peer.control({ action:'ipc', channel:'dsh-mini:drag', value:'move' })).ok,false)
  assert.equal((await peer.control({ action:'ipc', channel:'dsh-mini:drag', value:'start' })).ok,true)
  await peer.control({ action:'cursor', point:{ x:start.x + 220, y:start.y + 90 } })
  await new Promise(resolve => setTimeout(resolve, 60))
  const moved = (await peer.control({ action:'inspect' })).result.window.bounds
  assert.deepEqual([moved.x, moved.y], [start.x + 200, start.y + 80])
  assert.equal((await peer.control({ action:'ipc', channel:'dsh-mini:drag', value:'end' })).ok,true)
  await peer.control({ action:'cursor', point:{ x:start.x + 500, y:start.y + 300 } })
  await new Promise(resolve => setTimeout(resolve, 60))
  const released = (await peer.control({ action:'inspect' })).result.window.bounds
  assert.deepEqual([released.x, released.y], [moved.x, moved.y])
})
test('native IPC rejects subframes and malformed expansion, navigation/popups are origin constrained', async t => {
  const peer = await companion(t)
  await peer.command('show')
  assert.equal((await peer.control({ action:'ipc', channel:'dsh-mini:hide', untrusted:true })).ok,false)
  assert.equal((await peer.control({ action:'ipc', channel:'dsh-mini:set-expanded', value:'yes' })).ok,false)
  assert.deepEqual((await peer.control({ action:'ipc', channel:'dsh-mini:get-state' })).result,{ expanded:false, visible:true })
  for (const url of ['https://evil.test','http://127.0.0.1:3081','javascript:alert(1)','file:///tmp/local']) {
    for (const event of ['will-navigate','will-redirect','will-frame-navigate']) {
      const result = (await peer.control({ action:'navigation', url,event })).result
      assert.equal(result.prevented,true)
      assert.equal(result.popup,'deny')
    }
  }
  assert.equal((await peer.control({ action:'navigation', url:'http://127.0.0.1:3080/login' })).result.prevented,false)
})
test('CmdN prevents duplicate renderer handling, CmdW hides, Escape is not intercepted, stdin EOF exits', async t => {
  const peer = await companion(t)
  await peer.command('show')
  const key = process.platform === 'darwin' ? { meta:true, control:false } : { meta:false, control:true }
  assert.equal((await peer.control({ action:'input', value:{ ...key,type:'keyDown',key:'n' } })).result.prevented,true)
  assert.equal((await peer.control({ action:'input', value:{ ...key,type:'keyDown',key:'n',isAutoRepeat:true } })).result.prevented,true)
  assert.deepEqual((await peer.control({ action:'inspect' })).result.commands,['new-chat'])
  assert.equal((await peer.control({ action:'input', value:{ ...key,type:'keyDown',key:'Escape' } })).result.prevented,false)
  assert.equal((await peer.control({ action:'input', value:{ ...key,type:'keyDown',key:'w' } })).result.prevented,true)
  assert.equal((await peer.control({ action:'inspect' })).result.window.visible,false)
  peer.child.stdin.end()
  assert.equal((await peer.exited).code,0)
})
