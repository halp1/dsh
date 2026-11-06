import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdtemp, readFile, stat, rm, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defaultState } from '../shared/state.mjs'
import { StateStore, defaultStateFile, userDataDirectory } from '../src/host/store.mjs'
import { NativeRuntime, resolveElectron, sanitizeError, stoppedRuntime } from '../src/host/runtime.mjs'
import { MiniWindowController } from '../src/host/controller.mjs'
import { createRoutes } from '../src/host/routes.mjs'

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mini-host-'))
  t.after(async () => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '/dsh-mini-host-')); await rm(dir, { recursive: true, force: true }) })
  return dir
}
function fakeNative() {
  const native = {
    options: {}, runtime: stoppedRuntime(), calls: [], secretURL: 'http://127.0.0.1:3000/?token=secret-token',
    error(error) { this.runtime = { ...stoppedRuntime(), status: 'error', error: sanitizeError(error, this.secretURL) }; return new Error(this.runtime.error) },
    async start(settings) { this.calls.push(['start', settings]); this.runtime = { status: 'ready', visible: false, expanded: settings.expanded, shortcutRegistered: settings.enabled }; return this.runtime },
    async command(command, settings) { this.calls.push([command, settings]); if (command === 'show') this.runtime.visible = true; if (command === 'hide') this.runtime.visible = false; return this.runtime },
    async stop() { this.calls.push(['stop']); this.runtime = stoppedRuntime() },
    async dispose() { await this.stop() },
  }
  return native
}
async function fixture(t) {
  const dir = await directory(t)
  const store = new StateStore(join(dir, 'state.json'))
  const native = fakeNative()
  const controller = new MiniWindowController(store, native)
  await controller.loaded
  return { dir, store, native, controller, routes: createRoutes(controller) }
}
const post = (path, value) => new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(value), headers: { 'content-type': 'application/json' } })

function fakeSpawn({ ready = true, respond = true, onFrame } = {}) {
  const children = []
  const spawn = (executable, argv, options) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.frames = []; child.kills = []; child.alive = true
    child.emitFrame = frame => child.stdout.write(JSON.stringify(frame) + '\n')
    child.stdin = new Writable({ write(chunk, _, done) {
      const frame = JSON.parse(chunk.toString()); child.frames.push(frame)
      queueMicrotask(() => {
        onFrame?.(frame, child)
        if (frame.type === 'bootstrap') { if (ready) child.emitFrame({ type: 'ready', runtime: { visible: false, expanded: false, shortcutRegistered: true } }) }
        else if (frame.command === 'quit') child.kill('QUIT')
        else if (respond) child.emitFrame({ type: 'response', id: frame.id, ok: true, result: { visible: frame.command === 'show', shortcutRegistered: true } })
      })
      done()
    } })
    child.kill = (signal) => { child.kills.push(signal); if (child.alive) { child.alive = false; queueMicrotask(() => child.emit('exit', 0, signal)) }; return true }
    children.push({ child, executable, argv, options })
    return child
  }
  return { spawn, children }
}
async function runtimeFixture(t, fake = fakeSpawn(), extra = {}) {
  const dir = await directory(t)
  const native = new NativeRuntime({
    mainPath: fileURLToPath(new URL('../src/host/runtime.mjs', import.meta.url)), userDataDir: join(dir, 'userData'),
    authenticatedUrl: () => 'http://127.0.0.1:3000/?token=secret-token', resolveExecutable: async () => '/fake/electron',
    spawn: fake.spawn, startupTimeoutMs: 100, commandTimeoutMs: 100, stopTimeoutMs: 100, ...extra,
  })
  t.after(() => native.dispose())
  return { native, ...fake }
}

test('default file honors DSH_HOME and userData is profile-isolated', () => {
  assert.equal(defaultStateFile({ DSH_HOME: '/custom' }, '/home'), '/custom/plugins/mini-window/state.json')
  assert.equal(defaultStateFile({}, '/home'), '/home/.dsh/plugins/mini-window/state.json')
  assert.notEqual(userDataDirectory('/state/state.json', '/profiles/one'), userDataDirectory('/state/state.json', '/profiles/two'))
})

test('state persistence is atomic, private, normalized and loadable', async t => {
  const { store } = await fixture(t)
  await store.save({ ...defaultState(), lastSessionId: 'real-session' })
  assert.equal((await stat(store.file)).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await readFile(store.file, 'utf8')).revision, 1)
  const loaded = new StateStore(store.file)
  assert.equal((await loaded.load()).lastSessionId, 'real-session')
})

test('stale revision returns exact snapshot without configuring or writing', async t => {
  const { controller, native, routes } = await fixture(t)
  const response = await routes[0].fetch(post(routes[0].path, { baseRevision: 8, patch: { shortcut: 'Command+Alt+Space' } }))
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), controller.snapshot())
  assert.equal(native.calls.length, 0)
})

test('shortcut conflict leaves persisted state and previous native shortcut intact', async t => {
  const { controller, native, store, routes } = await fixture(t)
  await controller.activate()
  native.command = async (command, settings) => { native.calls.push([command, settings]); throw new Error('Shortcut is already registered.') }
  const response = await routes[0].fetch(post(routes[0].path, { baseRevision: 0, patch: { shortcut: 'Command+Alt+Space' } }))
  assert.equal(response.status, 422)
  assert.equal(store.current.shortcut, defaultState().shortcut)
  assert.equal(store.current.revision, 0)
  const result = await response.json()
  assert.equal(result.runtime.shortcutRegistered, true)
  assert.equal(result.runtime.status, 'ready')
  assert.match(result.runtime.error, /already registered/)
})

test('settings and geometry serialize, ignoring unknown geometry keys', async t => {
  const { controller, store, native } = await fixture(t)
  await controller.activate()
  let release
  const original = store.save.bind(store)
  let first = true
  store.save = async (...args) => { if (first) { first = false; await new Promise(resolve => { release = resolve }) } return original(...args) }
  const previousCalls = native.calls.length
  const mutate = controller.mutate({ baseRevision: 0, patch: { lastSessionId: 'session-2' } })
  await new Promise(resolve => setImmediate(resolve))
  const geometry = controller.geometry({ bounds: { x: 1.2, y: 3.4, width: 640, height: 112 }, expanded: false, shortcut: 'bad', revision: 500 })
  release()
  await Promise.all([mutate, geometry])
  assert.equal(store.current.revision, 2)
  assert.equal(store.current.lastSessionId, 'session-2')
  assert.equal(native.calls.length, previousCalls, 'Remembering a session must not reset native window geometry')
  assert.equal(store.current.shortcut, defaultState().shortcut)
  assert.deepEqual(store.current.bounds, { x: 1, y: 3, width: 640, height: 112 })
})

test('disk failure rolls native configuration back before rejecting save', async t => {
  const { controller, native, store } = await fixture(t)
  await controller.activate()
  store.save = async () => { throw new Error('Disk full') }
  await assert.rejects(controller.mutate({ baseRevision: 0, patch: { shortcut: 'Command+Alt+Space' } }), /Disk full/)
  assert.equal(native.calls.at(-1)[0], 'configure')
  assert.equal(native.calls.at(-1)[1].shortcut, defaultState().shortcut)
  assert.equal(store.current.revision, 0)
})

test('routes buffer authenticated requests and reject non-whitelist commands and patches', async t => {
  const { routes, native } = await fixture(t)
  assert.deepEqual(routes.map(r => [r.path, r.requestBody]), [['/api/dsh-mini-window.state', 'buffered'], ['/api/dsh-mini-window.command', 'buffered'], ['/api/dsh-mini-window.viewed', 'buffered']])
  for (const invalid of [{ command: 'configure' }, { command: 'show', url: 'evil' }, { command: '__proto__' }, []]) {
    assert.equal((await routes[1].fetch(post(routes[1].path, invalid))).status, 400)
  }
  assert.equal((await routes[0].fetch(post(routes[0].path, { baseRevision: 0, patch: { bounds: null } }))).status, 400)
  assert.equal(native.calls.length, 0)
})

test('missing runtime has actionable sanitized API error, no secret in snapshot', async t => {
  const { routes, native } = await fixture(t)
  native.start = async () => { throw native.error(new Error(`Install Electron; url=${native.secretURL} token=secret-token`)) }
  const response = await routes[1].fetch(post(routes[1].path, { command: 'show' }))
  assert.equal(response.status, 503)
  const text = await response.text()
  assert.match(text, /Install Electron/)
  assert.doesNotMatch(text, /secret-token|http:\/\/127/)
})

test('runtime single-flight bootstraps privately via stdin and starts hidden', async t => {
  const { native, children } = await runtimeFixture(t)
  const a = native.start(defaultState()), b = native.start(defaultState())
  assert.equal(a, b)
  await a
  assert.equal(children.length, 1)
  const { child, argv } = children[0]
  assert.equal(argv.length, 1)
  assert.doesNotMatch(JSON.stringify(argv), /secret-token/)
  assert.equal(child.frames[0].type, 'bootstrap')
  assert.match(child.frames[0].url, /secret-token/)
  assert.equal(native.runtime.status, 'ready')
  assert.equal(native.runtime.visible, false)
  await native.command('show')
  assert.equal(native.runtime.visible, true)
  await native.stop()
  assert.equal(native.runtime.status, 'stopped')
})

test('child exit rejects outstanding commands and does not restart automatically', async t => {
  const { native, children } = await runtimeFixture(t, fakeSpawn({ respond: false }))
  await native.start(defaultState())
  const pending = native.command('configure', defaultState())
  const rejection = assert.rejects(pending, /exited/)
  children[0].child.kill('SIGTERM')
  await rejection
  assert.equal(native.runtime.status, 'error')
  assert.equal(children.length, 1)
  assert.equal(native.pending.size, 0)
})

test('spawn error followed by close without exit releases startup and stop promises', async t => {
  const fake = fakeSpawn({ ready: false })
  const original = fake.spawn
  fake.spawn = (...args) => {
    const child = original(...args)
    child.kill = () => false
    queueMicrotask(() => {
      child.emit('error', new Error('spawn EACCES'))
      queueMicrotask(() => child.emit('close', -1, null))
    })
    return child
  }
  const { native } = await runtimeFixture(t, fake)
  await assert.rejects(native.start(defaultState()), /spawn EACCES/)
  assert.equal(native.child, null)
  await native.stop()
})

test('startup timeout terminates child without restart storm', async t => {
  const { native, children } = await runtimeFixture(t, fakeSpawn({ ready: false }), { startupTimeoutMs: 10 })
  await assert.rejects(native.start(defaultState()), /startup timed out/)
  assert.equal(children.length, 1)
  assert.ok(children[0].child.kills.includes('SIGTERM'))
  assert.equal(native.runtime.status, 'error')
})

test('oversized stdout frames fail closed, and child errors redact credentials', async t => {
  const fake = fakeSpawn({ onFrame(frame, child) { if (frame.type === 'bootstrap') child.stdout.write('X'.repeat(300)) } })
  const { native } = await runtimeFixture(t, fake, { maxFrameBytes: 256 })
  await assert.rejects(native.start(defaultState()), /frame limit/)
  assert.doesNotMatch(native.error(new Error('secret-token ' + native.secretURL)).message, /secret-token/)
})

test('Electron resolution only probes known dist binaries, never imports package main', async t => {
  const dir = await directory(t)
  const electron = join(dir, 'node_modules/electron')
  await mkdir(electron, { recursive: true })
  await writeFile(join(electron, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }))
  await writeFile(join(electron, 'index.js'), 'throw new Error("MUST NOT IMPORT")')
  const options = { anchors: [pathToFileURL(join(dir, 'package.json')).href], env: {}, platform: 'darwin' }
  await assert.rejects(resolveElectron(options), /Electron is not installed/)
  const binary = join(electron, 'dist/Electron.app/Contents/MacOS/Electron')
  await mkdir(resolve(binary, '..'), { recursive: true })
  await writeFile(binary, '#!/bin/sh\n', { mode: 0o700 })
  assert.equal(await resolveElectron(options), await realpath(binary))
  await assert.rejects(resolveElectron({ electronPath: join(dir, 'missing'), env: {} }), /Configured Electron executable/)
})

test('Electron runtime survives a profile reinstall that drops the package dist, and repairs itself when never kept', async t => {
  const dir = await directory(t)
  const electron = join(dir, 'node_modules/electron')
  await mkdir(electron, { recursive: true })
  await writeFile(join(electron, 'package.json'), JSON.stringify({ name: 'electron', version: '44.3.0', main: 'index.js' }))
  await writeFile(join(electron, 'index.js'), 'throw new Error("MUST NOT IMPORT")')
  const runtimeDir = join(dir, 'state/electron')
  const binary = join(electron, 'dist/Electron.app/Contents/MacOS/Electron')
  const installs = []
  const install = async packageDir => { installs.push(packageDir); await mkdir(resolve(binary, '..'), { recursive: true }); await writeFile(binary, '#!/bin/sh\n', { mode: 0o700 }) }
  const options = { anchors: [pathToFileURL(join(dir, 'package.json')).href], env: {}, platform: 'darwin', runtimeDir, install }
  const kept = join(runtimeDir, '44.3.0/Electron.app/Contents/MacOS/Electron')
  // Missing dist (install scripts skipped): the package installer repairs it, and a private copy is kept.
  assert.equal(await realpath(await resolveElectron(options)), await realpath(kept))
  assert.equal(installs.length, 1)
  // A later profile reinstall wipes the package dist; the kept copy is used without reinstalling.
  await rm(join(electron, 'dist'), { recursive: true, force: true })
  assert.equal(await realpath(await resolveElectron(options)), await realpath(kept))
  assert.equal(installs.length, 1)
  // A failed repair is actionable rather than the old manual-setup message.
  await rm(runtimeDir, { recursive: true, force: true })
  await assert.rejects(resolveElectron({ ...options, install: async () => { throw new Error('offline') } }), /could not be installed automatically \(offline\)/)
})

test('viewed route records finished sessions shown in the mini window and validates input', async t => {
  const { routes } = await fixture(t)
  const viewed = routes.find(route => route.path === '/api/dsh-mini-window.viewed')
  for (const invalid of [{}, { sessionId: '' }, { sessionId: 5 }, { sessionId: 'x', extra: 1 }, { sessionId: 'x'.repeat(257) }]) assert.equal((await viewed.fetch(post(viewed.path, invalid))).status, 400)
  const before = Date.now()
  const body = await (await viewed.fetch(post(viewed.path, { sessionId: 'session-1' }))).json()
  assert.ok(body.viewed['session-1'] >= before)
  const state = await (await routes[0].fetch(new Request('http://localhost' + routes[0].path))).json()
  assert.ok(state.viewed['session-1'] >= before)
})

test('disabled activation never spawns and disabling persists before quitting', async t => {
  const { controller, native, store } = await fixture(t)
  store.current.enabled = false
  await controller.activate()
  assert.equal(native.calls.length, 0)
  store.current.enabled = true
  await controller.activate()
  await controller.mutate({ baseRevision: 0, patch: { enabled: false } })
  assert.equal(store.current.enabled, false)
  assert.equal(native.calls.at(-2)[0], 'configure')
  assert.equal(native.calls.at(-1)[0], 'stop')
})

test('newly started shortcut conflict is acknowledged before persistence and restores old settings', async t => {
  const { controller, native, store } = await fixture(t)
  const oldShortcut = store.current.shortcut
  native.command = async (command, settings) => {
    native.calls.push([command, settings])
    if (settings.shortcut !== oldShortcut) throw new Error('Shortcut conflict')
    return native.runtime
  }
  const result = await controller.mutate({ baseRevision: 0, patch: { shortcut: 'Command+Alt+Space' } })
  assert.equal(result.status, 422)
  assert.equal(store.current.shortcut, oldShortcut)
  assert.equal(store.current.revision, 0)
  assert.equal(native.calls.at(-1)[1].shortcut, oldShortcut)
})

test('native startup status error is actionable rather than waiting for timeout', async t => {
  const fake = fakeSpawn({ ready: false, onFrame(frame, child) {
    if (frame.type === 'bootstrap') child.emitFrame({ type: 'status', runtime: { status: 'error', error: 'Another companion owns this profile.' } })
  } })
  const { native } = await runtimeFixture(t, fake)
  await assert.rejects(native.start(defaultState()), /Another companion owns/)
})

test('configure timeout kills uncertain native process and rejects pending work', async t => {
  const { native, children } = await runtimeFixture(t, fakeSpawn({ respond: false }), { commandTimeoutMs: 10 })
  await native.start(defaultState())
  await assert.rejects(native.command('configure', defaultState()), /command timed out/)
  assert.ok(children[0].child.kills.includes('SIGTERM'))
  assert.equal(native.pending.size, 0)
})

test('stop falls back to force kill when native ignores graceful quit', async t => {
  const fake = fakeSpawn()
  const spawn = fake.spawn
  fake.spawn = (...args) => {
    const child = spawn(...args)
    const originalKill = child.kill
    child.kill = signal => signal === 'QUIT' ? true : originalKill(signal)
    return child
  }
  const { native, children } = await runtimeFixture(t, fake, { stopTimeoutMs: 10 })
  await native.start(defaultState())
  await native.stop()
  assert.ok(children[0].child.kills.includes('SIGKILL'))
  assert.equal(native.runtime.status, 'stopped')
})

test('disabled commands never spawn a hidden disabled companion', async t => {
  const { controller, native, store } = await fixture(t)
  store.current.enabled = false
  await controller.command({ command: 'restart' })
  await assert.rejects(controller.command({ command: 'show' }), /disabled/)
  assert.equal(native.calls.filter(call => call[0] === 'start').length, 0)
})

test('corrupt state remains untouched and surfaces private actionable error', async t => {
  const dir = await directory(t)
  const file = join(dir, 'broken.json')
  await writeFile(file, 'not-json', { mode: 0o600 })
  const controller = new MiniWindowController(new StateStore(file), fakeNative())
  const routes = createRoutes(controller)
  const get = await routes[0].fetch(new Request('http://localhost' + routes[0].path))
  assert.match((await get.json()).runtime.error, /not valid JSON/)
  assert.equal((await routes[0].fetch(post(routes[0].path, { baseRevision: 0, patch: { enabled: false } }))).status, 503)
  assert.equal(await readFile(file, 'utf8'), 'not-json')
})

test('disposed host rejects future work and stops companion', async t => {
  const { controller, native } = await fixture(t)
  await controller.activate()
  await controller.dispose()
  assert.equal(native.runtime.status, 'stopped')
  await assert.rejects(controller.command({ command: 'show' }), /disposed/)
})
