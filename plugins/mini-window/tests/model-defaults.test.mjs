import test from 'node:test'
import assert from 'node:assert/strict'
import { MiniModels } from '../src/host/models.mjs'
import { Context } from '@deepseek-ai/cordis'
const { SessionStore } = await import(process.env.DSH_TEST_SESSION_MODULE ?? '@deepseek-ai/dsh-session')

const configured = () => ({ provider: 'antigravity', model: 'runtime-tier-key', reasoningEffort: 'high' })
const availableCatalog = () => ({
  default: { provider: 'main-provider', model: 'main-model', reasoningEffort: 'low' },
  routableProviders: ['antigravity'], failures: [],
  groups: [{ id: 'antigravity', name: 'Google Antigravity', models: [{
    id: 'runtime-tier-key', name: 'Gemini3.8 Flash Tiered',
    reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  }] }],
})
function fixture(defaultModel = configured(), failAt) {
  const calls = [], records = new Map()
  const snapshot = { state: { defaultModel } }
  const catalog = availableCatalog()
  const globalDefault = structuredClone(catalog.default)
  const fail = step => { if (failAt === step) throw new Error(`${step} failed`) }
  const services = {
    sessionController: {
      async modelCatalog() { calls.push(['catalog']); fail('catalog'); return catalog },
      async create(request) {
        calls.push(['core-create', { ...request }]); fail('core-create')
        if (request.sessionId) {
          const record = records.get(request.sessionId)
          assert.ok(record.durable, 'ordinary core creation must start after durability')
          assert.ok(record.closed, 'ordinary core creation must not contend with the seed writer')
          assert.equal(record.events.length, 1)
          assert.equal(record.events[0].type, 'model/selection')
          // The normal core modelSelection fold reads this pending selection.
          record.pendingSelection = record.events[0].data
        }
        return { sessionId: request.sessionId ?? 'ordinary-new-session', agentPreset: 'normal-preset' }
      },
      selectModel() { assert.fail('selectModel also changes global defaults') },
    },
    workspaceRegistry: { get(id) { calls.push(['workspace', id]); return id === 'workspace-1' ? { id, path: '/work/project' } : undefined } },
    sessions: {
      prepare(id, options) {
        calls.push(['prepare', id, structuredClone(options)]); fail('prepare')
        const header = { id, version: 4, createdAt: 1234, isSeeded: false, ...options.meta }
        assert.equal(options.seed.length, 1)
        assert.equal(options.seed[0].type, 'model/selection')
        assert.equal(options.seed[0].seq, 0)
        assert.ok(Number.isSafeInteger(options.seed[0].time))
        return { header, append() { assert.fail('prepared sessions cannot append outside a SessionStore') } }
      },
      create() { assert.fail('do not publish an independently owned Session') },
      enter() { assert.fail('do not enter the detached Session') },
      flush() { assert.fail('detached Sessions have no live writer to flush') },
    },
    sessionPersistence: {
      async create(header) {
        calls.push(['storage-create', { ...header }]); fail('storage-create')
        assert.ok(!records.has(header.id), 'never overwrite a preexisting Session')
        const record = { header, events: [], durable: false, closed: false }
        records.set(header.id, record)
        return {
          async append(events) { calls.push(['storage-append', structuredClone(events)]); fail('storage-append'); record.events.push(...events) },
          async flush() { calls.push(['storage-flush']); fail('storage-flush'); record.durable = true },
          async close() { calls.push(['storage-close']); record.closed = true; fail('storage-close') },
        }
      },
      delete() { assert.fail('never destructively roll back durable Session storage') },
    },
    agentDefaultModel: { saveSelection() { assert.fail('never save a global model default') } },
    agents: { create() { assert.fail('normal core owns the Agent'); }, resume() { assert.fail('normal core owns the Agent') } },
  }
  const ctx = { get(name) { return services[name] } }
  const controller = { async get() { calls.push(['settings']); return snapshot } }
  return { models: new MiniModels(ctx, controller), services, snapshot, catalog, calls, records, globalDefault }
}

test('mini default seeds a canonical pending selection before ordinary core creation', async () => {
  const f = fixture()
  const result = await f.models.create({ workspaceId: 'workspace-1' })
  assert.match(result.sessionId, /^session-[0-9a-f-]{36}$/)
  assert.deepEqual(Object.keys(result), ['sessionId'])
  const record = f.records.get(result.sessionId)
  assert.deepEqual(record.pendingSelection, configured())
  assert.deepEqual(record.header, { id: result.sessionId, version: 4, createdAt: 1234, isSeeded: false, cwd: '/work/project' })
  assert.deepEqual(f.calls.map(call => call[0]), ['settings', 'catalog', 'workspace', 'prepare', 'storage-create', 'storage-append', 'storage-flush', 'storage-close', 'core-create'])
  assert.deepEqual(f.calls.at(-1)[1], { sessionId: result.sessionId, workspaceId: 'workspace-1' })
  assert.deepEqual(f.catalog.default, f.globalDefault)
  assert.deepEqual(f.snapshot.state.defaultModel, configured())
})

test('mini creation works through the real SessionStore preparation boundary', async () => {
  const f = fixture()
  const ctx = new Context()
  const fiber = ctx.plugin(SessionStore)
  await fiber.await()
  try {
    f.services.sessions = ctx.get('sessions')
    const result = await f.models.create({ workspaceId: 'workspace-1' })
    const record = f.records.get(result.sessionId)
    assert.deepEqual(record.pendingSelection, configured())
    assert.equal(record.header.isSeeded, false)
    assert.equal(f.services.sessions.get(result.sessionId), undefined)
    assert.ok(record.durable && record.closed)
  } finally {
    await fiber.dispose()
  }
})

test('uncategorized mini default seeds a normal session without attaching a workspace', async () => {
  const f = fixture()
  const result = await f.models.create({ workspaceId: null })
  assert.deepEqual(f.records.get(result.sessionId).pendingSelection, configured())
  assert.equal(f.records.get(result.sessionId).header.cwd, process.cwd())
  assert.equal(f.calls.some(call => call[0] === 'workspace'), false)
  assert.deepEqual(f.calls.at(-1)[1], { sessionId: result.sessionId })
})
test('uncategorized chat without a mini default delegates unscoped core creation', async () => {
  const f = fixture(null)
  assert.deepEqual(await f.models.create({ workspaceId: null }), { sessionId: 'ordinary-new-session' })
  assert.deepEqual(f.calls, [['settings'], ['core-create', {}]])
})
test('null or legacy missing mini default delegates ordinary creation without model writes', async () => {
  for (const preference of [null, undefined]) {
    const f = fixture(null)
    f.snapshot.state.defaultModel = preference
    assert.deepEqual(await f.models.create({ workspaceId: 'workspace-1' }), { sessionId: 'ordinary-new-session' })
    assert.deepEqual(f.calls, [['settings'], ['core-create', { workspaceId: 'workspace-1' }]])
    assert.equal(f.records.size, 0)
  }
})

test('catalog returns the live raw catalog and unwraps a public RemoteResult face', async () => {
  const f = fixture()
  assert.equal(await f.models.catalog(), f.catalog)
  f.services.sessionController.modelCatalog = async () => ({ ok: true, value: f.catalog })
  assert.equal(await f.models.catalog(), f.catalog)
  const ordinary = f.services.sessionController.create
  f.services.sessionController.create = async request => ({ ok: true, value: await ordinary(request) })
  assert.ok((await f.models.create({ workspaceId: 'workspace-1' })).sessionId)
})

test('invalid body cannot select existing Sessions, override chosen preferences, or supply cwd', async () => {
  for (const body of [null, [], {}, { workspaceId: '' }, { workspaceId: 1 }, { workspaceId: 'workspace-1', sessionId: 'existing' }, { workspaceId: 'workspace-1', cwd: '/elsewhere' }, { workspaceId: 'workspace-1', defaultModel: configured() }]) {
    const f = fixture()
    await assert.rejects(f.models.create(body), error => error.status === 400)
    assert.deepEqual(f.calls, [])
  }
})

test('only exact advertised provider, model and reasoning IDs are accepted', async () => {
  for (const selection of [
    { ...configured(), provider: 'Google Antigravity' },
    { ...configured(), model: 'Gemini3.8 Flash Tiered' },
    { ...configured(), model: 'guessed-gemini-native-id' },
    { ...configured(), reasoningEffort: 'High' },
    { ...configured(), reasoningEffort: 'unsupported' },
  ]) {
    const f = fixture(selection)
    await assert.rejects(f.models.create({ workspaceId: 'workspace-1' }), error => error.status === 422)
    assert.equal(f.records.size, 0)
    assert.ok(!f.calls.some(call => call[0] === 'prepare' || call[0] === 'core-create'))
  }
})

test('provider-default reasoning stays omitted rather than copied from a label', async () => {
  const f = fixture({ provider: 'antigravity', model: 'runtime-tier-key' })
  const result = await f.models.create({ workspaceId: 'workspace-1' })
  assert.deepEqual(f.records.get(result.sessionId).pendingSelection, { provider: 'antigravity', model: 'runtime-tier-key' })
})

test('invalid saved preference shapes fail closed before storage creation', async () => {
  for (const selection of [false, [], 'runtime-tier-key', {}, { ...configured(), provider: '' }, { ...configured(), reasoningEffort: null }, { ...configured(), speedMode: 'fast' }]) {
    const f = fixture(selection)
    await assert.rejects(f.models.create({ workspaceId: 'workspace-1' }), error => error.status === 400)
    assert.equal(f.records.size, 0)
  }
})

test('catalog service failure or malformed/ambiguous unavailable catalogs never seed storage', async () => {
  const responses = [
    { ok: false, error: { message: 'catalog disconnected' } }, null, {},
    { ...availableCatalog(), groups: [{ id: 'antigravity', name: 'Google Antigravity', models: [{ id: 'runtime-tier-key', name: 'tier', reasoning: { efforts: [{ id: 'high' }] } }] }] },
  ]
  for (const response of responses) {
    const f = fixture()
    f.services.sessionController.modelCatalog = async () => response
    await assert.rejects(f.models.create({ workspaceId: 'workspace-1' }), error => error.status === 503)
    assert.equal(f.records.size, 0)
  }
  for (const transform of [catalog => { catalog.groups[0].models.push(structuredClone(catalog.groups[0].models[0])) }, catalog => { catalog.routableProviders = [] }]) {
    const f = fixture()
    transform(f.catalog)
    await assert.rejects(f.models.create({ workspaceId: 'workspace-1' }), error => error.status === 422)
    assert.equal(f.records.size, 0)
  }
})

test('the selected preference is captured before asynchronous discovery and never shared', async () => {
  const f = fixture()
  let signalStarted, release
  const started = new Promise(resolve => { signalStarted = resolve })
  const gate = new Promise(resolve => { release = resolve })
  f.services.sessionController.modelCatalog = async () => { signalStarted(); await gate; return f.catalog }
  const creation = f.models.create({ workspaceId: 'workspace-1' })
  await started
  f.snapshot.state.defaultModel.model = 'changed-while-discovering'
  f.snapshot.state.defaultModel.reasoningEffort = 'low'
  release()
  const result = await creation
  assert.deepEqual(f.records.get(result.sessionId).pendingSelection, configured())
  f.records.get(result.sessionId).pendingSelection.model = 'edited-test-record'
  assert.equal(f.snapshot.state.defaultModel.model, 'changed-while-discovering')
})

test('ordinary preset identity is seeded but mounting and Agent ownership remain core responsibilities', async () => {
  const f = fixture()
  f.services.agentPresets = { async resolve() { return { id: 'normal-preset' } }, mount() { assert.fail('core mounts presets') } }
  const result = await f.models.create({ workspaceId: 'workspace-1' })
  assert.equal(f.records.get(result.sessionId).header.agentPreset, 'normal-preset')
  assert.deepEqual(f.calls.at(-1)[1], { sessionId: result.sessionId, workspaceId: 'workspace-1' })
})

test('storage handles close on append/flush failure; failed new records are retained', async () => {
  for (const failure of ['storage-append', 'storage-flush', 'storage-close']) {
    const f = fixture(configured(), failure)
    await assert.rejects(f.models.create({ workspaceId: 'workspace-1' }), new RegExp(`${failure} failed`))
    assert.equal(f.records.size, 1)
    assert.ok([...f.records.values()][0].closed)
    assert.ok(f.calls.some(call => call[0] === 'storage-close'))
    assert.ok(!f.calls.some(call => call[0] === 'core-create'))
  }
})

test('ordinary core creation failure leaves the new durable record closed and intact', async () => {
  const f = fixture(configured(), 'core-create')
  await assert.rejects(f.models.create({ workspaceId: 'workspace-1' }), /core-create failed/)
  const record = [...f.records.values()][0]
  assert.ok(record.durable)
  assert.ok(record.closed)
  assert.deepEqual(record.events[0].data, configured())
  assert.deepEqual(f.catalog.default, f.globalDefault)
})

test('each explicit new mini chat uses a different newly allocated identity', async () => {
  const f = fixture()
  const first = await f.models.create({ workspaceId: 'workspace-1' })
  const second = await f.models.create({ workspaceId: 'workspace-1' })
  assert.notEqual(first.sessionId, second.sessionId)
  assert.equal(f.records.size, 2)
})

test('missing workspaces fail before creating any durable record', async () => {
  const f = fixture()
  await assert.rejects(f.models.create({ workspaceId: 'missing' }), error => error.status === 404)
  assert.equal(f.records.size, 0)
})
