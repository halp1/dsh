import assert from 'node:assert/strict'
import test from 'node:test'
import { createReviewer, prepareState, resolveConfig, routeAnswers } from '../src/review.js'

const config = resolveConfig()
const env = { TYPESAFE_API_KEY: 'test-only-not-a-real-api-key' }
const state = { operation: { tool: 'read', path: '/workspace/notes.txt' }, policy: 'Never disclose credentials. Ask before destructive or external actions.' }

function choice(selected, options, probability = 1, confidence = 1) {
  const probabilities = Object.fromEntries(options.map((option) => [option, 0]))
  probabilities[selected] = probability
  probabilities[options.find((option) => option !== selected)] = 1 - probability
  return { type: 'choice', choice: selected, probabilities, confidence }
}

function response(action = 'allow', effect = 'low-risk', probability = 1, confidence = 1) {
  return {
    model: config.model,
    answers: {
      action: choice(action, ['allow', 'reject', 'human'], probability, confidence),
      effect: choice(effect, ['low-risk', 'human-required', 'prohibited', 'unknown'], probability, confidence),
    },
    usage: { input_tokens: 100, output_tokens: 20 },
  }
}

function fakeClient(result = response()) {
  const calls = []
  return {
    calls,
    async systemOne(request, options) {
      calls.push({ request, options })
      return result
    },
  }
}

test('configuration rejects typos, unsafe model identifiers, invalid types, accessors and invalid thresholds', () => {
  for (const raw of [
    null, [], { enabled: 'false' }, { model: 'jev-1\nsecret' }, { model: 'jev-' + 'x'.repeat(129) },
    { timeoutMs: 0 }, { timeoutMs: 1.5 }, { maxStateBytes: Infinity }, { maxStateBytes: 1_048_577 },
    { allowProbability: NaN }, { rejectProbability: -0.01 }, { minConfidence: 1.01 },
    { allowProbabilty: 0.5 }, { apiKey: 'never-accept-config-credentials' },
  ]) assert.throws(() => resolveConfig(raw), TypeError)
  let getterCalled = false
  assert.throws(() => resolveConfig({ get enabled() { getterCalled = true } }), TypeError)
  assert.equal(getterCalled, false)
  const stricter = resolveConfig({ allowProbability: 1, rejectProbability: 1, minConfidence: 1 })
  assert.equal(routeAnswers(response('allow', 'low-risk', 0.999), stricter).decision, 'human')
  assert.equal(routeAnswers(response('reject', 'prohibited'), stricter).decision, 'reject')
})

test('routing requires agreement, both probabilities, both confidences and inclusive threshold boundaries', () => {
  for (const [action, effect, expected] of [
    ['allow', 'low-risk', 'allow'], ['reject', 'prohibited', 'reject'],
    ['allow', 'prohibited', 'human'], ['reject', 'low-risk', 'human'],
    ['allow', 'human-required', 'human'], ['reject', 'unknown', 'human'], ['human', 'prohibited', 'human'],
  ]) assert.equal(routeAnswers(response(action, effect)).decision, expected)
  for (const [action, effect] of [['allow', 'low-risk'], ['reject', 'prohibited']]) {
    assert.equal(routeAnswers(response(action, effect, 0.99, 0.9)).decision, action)
    for (const question of ['action', 'effect']) {
      const lowProbability = response(action, effect, 0.99, 0.9)
      const answer = lowProbability.answers[question]
      const selected = answer.choice
      const other = Object.keys(answer.probabilities).find((option) => option !== selected)
      answer.probabilities[selected] = 0.989999
      answer.probabilities[other] = 1 - 0.989999
      assert.equal(routeAnswers(lowProbability).code, 'insufficient-probability')
      const lowConfidence = response(action, effect)
      lowConfidence.answers[question].confidence = 0.899999
      assert.equal(routeAnswers(lowConfidence).code, 'insufficient-confidence')
    }
  }
  const original = response()
  const routed = routeAnswers(original)
  original.answers.action.probabilities.allow = 0
  assert.equal(routed.probabilities.action.allow, 1)
})

test('malformed or contradictory external response shapes always fail closed without raw metadata', () => {
  const mutations = [
    (r) => { r.model = 'jev-other' },
    (r) => { r.model = 'arbitrary\ncredential text' },
    (r) => { delete r.answers.effect },
    (r) => { r.answers.extra = r.answers.action },
    (r) => { r.answers.action.type = 'score' },
    (r) => { r.answers.action.choice = 'execute' },
    (r) => { r.answers.action.confidence = null },
    (r) => { r.answers.effect.confidence = Infinity },
    (r) => { r.answers.action.confidence = -1 },
    (r) => { r.answers.action.probabilities.allow = '1' },
    (r) => { r.answers.action.probabilities.allow = NaN },
    (r) => { r.answers.action.probabilities.human = -0.1 },
    (r) => { r.answers.effect.probabilities.unknown = 0.1 },
    (r) => { delete r.answers.action.probabilities.human },
    (r) => { r.answers.action.probabilities.other = 0 },
    (r) => { r.answers.action.probabilities = { allow: 0.4, reject: 0.6, human: 0 } },
    (r) => { r.answers.action.probabilities = { allow: 0.5, reject: 0.5, human: 0 } },
    (r) => { r.answers.effect.probabilities = { 'low-risk': 0.5, 'human-required': 0, prohibited: 0.5, unknown: 0 } },
    (r) => { r.answers.action.explanation = 'untrusted secret detail' },
    (r) => { r.usage.input_tokens = -1 },
    (r) => { r.extra = 'untrusted secret detail' },
    (r) => { Object.defineProperty(r.answers, 'action', { get() { throw new Error('not read') } }) },
  ]
  for (const mutate of mutations) {
    const candidate = response()
    mutate(candidate)
    assert.deepEqual(routeAnswers(candidate), { decision: 'human', code: 'invalid-response' })
  }
  for (const candidate of [null, [], {}, { model: config.model, answers: null }]) {
    assert.deepEqual(routeAnswers(candidate), { decision: 'human', code: 'invalid-response' })
  }
  const nullableUsage = response()
  nullableUsage.usage = { input_tokens: null, output_tokens: null }
  assert.equal(routeAnswers(nullableUsage).decision, 'allow')
  const rounded = response('allow', 'low-risk', 0.9999998)
  rounded.answers.action.probabilities.human = 0.0000001
  assert.equal(routeAnswers(rounded).decision, 'allow')
})

test('JSON snapshot preserves complete structure, byte boundaries and source independence', () => {
  const input = { operation: { command: ['read', '👋'], nullField: null, count: 2, flag: false } }
  const bytes = Buffer.byteLength(JSON.stringify(input))
  const prepared = prepareState(input, resolveConfig({ maxStateBytes: bytes }))
  assert.equal(prepared.ok, true)
  assert.equal(prepared.bytes, bytes)
  assert.deepEqual(prepared.state, input)
  input.operation.command[0] = 'changed'
  assert.equal(prepared.state.operation.command[0], 'read')
  assert.deepEqual(prepareState(input, resolveConfig({ maxStateBytes: 3 })), { ok: false, code: 'state-too-large' })
  const namedProto = JSON.parse('{"__proto__":{"label":"ordinary JSON"}}')
  const snapshot = prepareState(namedProto)
  assert.deepEqual(snapshot.state, namedProto)
  assert.equal(Object.getPrototypeOf(snapshot.state), Object.prototype)
})

test('non-JSON state is rejected without invoking serializers or accessors', () => {
  const cycle = {}
  cycle.self = cycle
  const sparse = new Array(2)
  let executed = false
  const accessor = { get hidden() { executed = true } }
  const serializer = { toJSON() { executed = true } }
  let deep = {}
  for (const _depth of Array.from({ length: 40 })) deep = { nested: deep }
  for (const input of [
    null, undefined, 3, true, { nested: undefined }, { n: NaN }, { n: Infinity }, { n: 1n },
    { n: Symbol('x') }, { n() {} }, cycle, sparse, new Date(), new Map(), accessor, serializer, deep,
    { [Symbol('hidden')]: 'data' }, Object.defineProperty({}, 'hidden', { value: 'data' }),
  ]) assert.deepEqual(prepareState(input), { ok: false, code: 'invalid-state' })
  assert.equal(executed, false)
})

test('sensitive nested values, keys, embedded tokens, PEM and credential URLs never reach transport', async () => {
  const inputs = [
    { nested: [{ api_key: 'value' }] }, { nested: { accessToken: 'value' } },
    { nested: { 'PRIVATE-KEY': 'value' } }, { nested: { Authorization: 'value' } },
    { text: 'execute --header "Authorization: Bearer abcdef0123456789"' },
    { text: 'https://person:password@example.com/path' },
    { text: 'postgres://person:password@db.local/data' },
    { text: 'https://example.com?api_key=abcdefg' },
    { text: 'TYPESAFE_API_KEY=abcdef012345' },
    { text: '-----BEGIN RSA PRIVATE KEY-----\nbody\n-----END RSA PRIVATE KEY-----' },
    { text: 'ghp_' + 'a'.repeat(36) }, { text: 'sk-proj-' + 'a'.repeat(32) },
    { text: 'AKIAABCDEFGHIJKLMNOP' }, { text: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoxfQ.signature' },
  ]
  const client = fakeClient()
  const review = createReviewer(config, { client, env })
  for (const input of inputs) {
    assert.deepEqual(prepareState(input), { ok: false, code: 'sensitive-state' })
    assert.deepEqual(await review(input), { decision: 'human', code: 'sensitive-state' })
  }
  assert.equal(client.calls.length, 0)
  assert.equal(prepareState(state).ok, true)
})

test('eligible reviews make one batched SDK call with no retry and propagate cancellation options', async () => {
  const client = fakeClient(response('reject', 'prohibited'))
  const review = createReviewer(config, { client, env })
  const caller = new AbortController()
  const result = await review(state, caller.signal)
  assert.equal(result.decision, 'reject')
  assert.equal(client.calls.length, 1)
  const { request, options } = client.calls[0]
  assert.deepEqual(Object.keys(request.questions), ['action', 'effect'])
  assert.deepEqual(Object.keys(request.questions.action.criteria), ['allow', 'reject', 'human'])
  assert.deepEqual(Object.keys(request.questions.effect.criteria), ['low-risk', 'human-required', 'prohibited', 'unknown'])
  assert.deepEqual(request.state, state)
  assert.notEqual(request.state, state)
  assert.equal(request.model, config.model)
  assert.equal(options.timeout, config.timeoutMs)
  assert.equal(options.retry.maxRetries, 0)
  assert.ok(options.signal instanceof AbortSignal)
})

test('disabled, missing credentials, invalid or oversized state and pre-abort do not call transport', async () => {
  const client = fakeClient()
  assert.equal((await createReviewer({ enabled: false }, { client, env })(state)).code, 'disabled')
  for (const absent of [{}, { TYPESAFE_API_KEY: '  ' }]) {
    assert.equal((await createReviewer(config, { client, env: absent })(state)).code, 'missing-api-key')
  }
  assert.equal((await createReviewer(config, { client, env })({ n: undefined })).code, 'invalid-state')
  assert.equal((await createReviewer({ maxStateBytes: 2 }, { client, env })(state)).code, 'state-too-large')
  const aborted = new AbortController()
  aborted.abort()
  assert.equal((await createReviewer(config, { client, env })(state, aborted.signal)).code, 'aborted')
  assert.equal(client.calls.length, 0)
})

test('service failure, parent cancellation and timeout return bounded human results even if transport ignores abort', async () => {
  const failing = { async systemOne() { throw new Error('request body and secret error must not escape') } }
  assert.deepEqual(await createReviewer(config, { client: failing, env })(state), { decision: 'human', code: 'service-error' })
  let requestSignal
  const hanging = {
    systemOne(_request, options) {
      requestSignal = options.signal
      return new Promise(() => {})
    },
  }
  const parent = new AbortController()
  const pending = createReviewer(config, { client: hanging, env })(state, parent.signal)
  parent.abort()
  assert.deepEqual(await pending, { decision: 'human', code: 'aborted' })
  assert.equal(requestSignal.aborted, true)
  assert.deepEqual(await createReviewer({ timeoutMs: 5 }, { client: hanging, env })(state), { decision: 'human', code: 'timeout' })
  assert.equal(requestSignal.aborted, true)
  let finish
  const late = { systemOne() { return new Promise((resolve) => { finish = resolve }) } }
  const lateParent = new AbortController()
  const latePending = createReviewer(config, { client: late, env })(state, lateParent.signal)
  lateParent.abort()
  finish(response())
  assert.equal((await latePending).decision, 'human')
})

test('real SDK uses only mocked fetch, pinned origin and one attempt with SDK logging disabled', async (t) => {
  const logs = []
  for (const method of ['debug', 'info', 'warn', 'error', 'log']) t.mock.method(console, method, (...args) => logs.push(args))
  for (const [key, value] of Object.entries({ TYPESAFE_LOG_LEVEL: 'debug', TYPESAFE_BASE_URL: 'https://attacker.invalid' })) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    })
  }
  let calls = 0
  const fetch = async (url, init) => {
    calls += 1
    assert.equal(new URL(url).origin, 'https://api.typesafe.ai')
    assert.ok(init.signal instanceof AbortSignal)
    return Response.json(response())
  }
  const result = await createReviewer(config, { fetch, env })(state)
  assert.equal(result.decision, 'allow')
  assert.equal(calls, 1)
  const failFetch = async () => {
    calls += 1
    return Response.json({ message: 'raw upstream error must not leak' }, { status: 500 })
  }
  assert.deepEqual(await createReviewer(config, { fetch: failFetch, env })(state), { decision: 'human', code: 'service-error' })
  assert.equal(calls, 2)
  assert.deepEqual(logs, [])
})
