import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { apply, inject, Config } from '../src/index.ts'
import { defaultState } from '../shared/state.mjs'

test('Cordis host injects authenticated services and registers buffered fetch routes with disposal', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mini-plugin-'))
  t.after(async () => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '/dsh-mini-plugin-')); await rm(dir, { recursive: true, force: true }) })
  const file = join(dir, 'state.json')
  await writeFile(file, JSON.stringify({ ...defaultState(), enabled: false }), { mode: 0o600 })
  const routes = [], disposers = []
  let authCalls = 0, unregistered = 0
  const services = {
    connection: { fetch: { register(route) { routes.push(route); return async () => { unregistered++ } } }, authenticatedUrl() { authCalls++; return 'NEVER-PUBLIC' } },
    webServer: { port: 9876 },
    profileContext: { dir: join(dir, 'profiles/web') },
    launchEnvironment: { get: () => undefined },
  }
  const ctx = { get: key => services[key], effect(callback) { disposers.push(callback()) } }
  assert.deepEqual(inject, ['connection', 'webServer', 'sessions', 'sessionPersistence', 'sessionController', 'workspaceRegistry'])
  assert.ok(Config)
  apply(ctx, { stateFile: file })
  assert.deepEqual(routes.map(route => route.path), ['/api/dsh-mini-window.state', '/api/dsh-mini-window.command', '/api/dsh-mini-window.viewed', '/api/dsh-mini-window.models', '/api/dsh-mini-window.chat'])
  assert.deepEqual(routes.map(route => route.requestBody), ['buffered', 'buffered', 'buffered', 'buffered', 'buffered'])
  const response = await routes[0].fetch(new Request('http://localhost' + routes[0].path))
  const snapshot = await response.json()
  assert.equal(snapshot.state.enabled, false)
  assert.equal(snapshot.runtime.status, 'stopped')
  assert.equal(authCalls, 0)
  for (const dispose of disposers.reverse()) await dispose()
  assert.equal(unregistered, 5)
})
