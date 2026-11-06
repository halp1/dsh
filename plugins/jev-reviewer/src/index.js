import { resolveConfig, createReviewer } from './review.js'
import { runtimeOptions } from './config.js'
export { Config } from './config.js'
import {
  buildState, identifyEscalation, operationKey, sandboxDenied, supportedTool,
} from './context.js'

export const name = 'jev-reviewer'
export const inject = ['approval', 'tools', 'sandboxPolicy', 'workingDirectory', 'sessionQuery']

/** Race uncooperative transports too. Late values can never settle an approval. */
function abortable(work, signal) {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function service(ctx, agent, key) {
  return agent.ctx?.get(key) ?? ctx.get(key)
}

function policyFor(ctx, agent) {
  const policy = service(ctx, agent, 'sandboxPolicy').resolve({ session: agent.session })
  // Copy only the security-relevant fields. Object identity is not a policy version.
  return {
    mode: policy.mode,
    workspaceRoot: policy.workspaceRoot,
    additionalWritableRoots: [...(policy.additionalWritableRoots ?? [])],
  }
}

function directoryFor(ctx, agent) {
  return service(ctx, agent, 'workingDirectory').get(agent.session)
}

function never(ctx, agent) {
  const approval = service(ctx, agent, 'approval')
  return (approval.overrideOf(agent.session) ?? approval.config.policy ?? 'ask') === 'never'
}

function definitionFor(ctx, exec) {
  return service(ctx, exec.agent, 'tools').get(exec.name, exec.agent, exec.toolSet)
}

/** Host-only middleware, exported to allow integration tests with a fake Jev transport. */
export function installReviewer(ctx, rawConfig = {}, options = {}) {
  const { policy, getApiKey } = runtimeOptions(rawConfig)
  const config = resolveConfig(policy)
  if (!config.enabled) return
  const review = options.review ?? createReviewer(config, { getApiKey })
  const logger = ctx.logger('jev-reviewer')
  const lifetime = new AbortController()
  const records = new Set()
  const byToken = new Map()
  const byAgent = new WeakMap()
  const denials = new WeakMap()
  const versions = new WeakMap()
  const turnEpochs = new WeakMap()
  const disposers = []

  function bucket(agent) {
    let calls = byAgent.get(agent)
    if (!calls) byAgent.set(agent, calls = new Map())
    return calls
  }

  function retire(record) {
    if (record.closed) return
    record.closed = true
    record.active = false
    record.lifetime.abort(new Error('execution-ended'))
    record.exec.signal.removeEventListener('abort', record.abort)
    const calls = byAgent.get(record.exec.agent)
    const group = calls?.get(record.exec.callId)
    group?.delete(record)
    if (!group?.size) calls?.delete(record.exec.callId)
    records.delete(record)
    byToken.delete(record.exec.token)
  }

  function unique(agent, callId) {
    const group = byAgent.get(agent)?.get(callId)
    return group?.size === 1 ? group.values().next().value : undefined
  }

  function log(request, result, started) {
    // No commands, arguments, text, paths, API failures, or credentials in logs.
    const safeId = (value) => typeof value === 'string' && value.length <= 256 ? value : undefined
    try {
      logger.info(JSON.stringify({
        event: 'jev-review',
        sessionId: safeId(request.agent.session.id),
        callId: safeId(request.callId),
        tool: request.toolName,
        decision: result.decision,
        code: /^[a-z-]{1,64}$/.test(result.code) ? result.code : 'review-result',
        ...(typeof result.model === 'string' && /^jev-[\w.-]{1,80}$/.test(result.model)
          ? { model: result.model } : {}),
        ...(result.probabilities ? { probabilities: result.probabilities, confidence: result.confidence } : {}),
        latencyMs: Date.now() - started,
      }))
    } catch {
      // DSH owns the authoritative approval audit. Supplemental logging is not a grant.
    }
  }

  disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      if (exec.agent && supportedTool(exec.name) && typeof exec.token === 'symbol' && !exec.signal.aborted) {
        const calls = bucket(exec.agent)
        let group = calls.get(exec.callId)
        if (!group) calls.set(exec.callId, group = new Set())
        const record = {
          exec,
          policy: policyFor(ctx, exec.agent),
          cwd: directoryFor(ctx, exec.agent),
          definition: definitionFor(ctx, exec),
          turnEpoch: turnEpochs.get(exec.agent.session) ?? 0,
          lifetime: new AbortController(),
          active: false,
          closed: false,
        }
        record.abort = () => retire(record)
        group.add(record)
        records.add(record)
        byToken.set(exec.token, record)
        exec.signal.addEventListener('abort', record.abort, { once: true })
      }
    } catch {
      // Uninspectable calls retain their normal human approval path.
    }
    return next()
  }, { global: true, prepend: true }))

  disposers.push(ctx.on('tools/execute', async (exec, next) => {
    const record = byToken.get(exec.token)
    if (!record || record.exec.agent !== exec.agent || record.exec.callId !== exec.callId) return next()
    record.active = true
    try {
      return await next()
    } finally {
      record.active = false
    }
  }, { global: true, prepend: true }))

  disposers.push(ctx.on('tools/result', (exec, result) => {
    const record = byToken.get(exec.token)
    if (!record || record.exec.agent !== exec.agent || record.exec.callId !== exec.callId) return
    try {
      let journal = denials.get(exec.agent)
      if (!journal) denials.set(exec.agent, journal = new Map())
      const key = operationKey(exec.name, exec.arguments, record.policy, record.cwd)
      journal.delete(key)
      // Only actual runtime sandbox facts qualify, never stdout or reason text.
      if (!exec.signal.aborted && sandboxDenied(result, record.policy.mode) &&
          record.turnEpoch === (turnEpochs.get(exec.agent.session) ?? 0) &&
          (exec.arguments.sandbox_permissions === undefined ||
           exec.arguments.sandbox_permissions === record.policy.mode)) {
        journal.set(key, record.turnEpoch)
        if (journal.size > 64) journal.delete(journal.keys().next().value)
      }
    } catch {
      // A missing retry record only removes automatic eligibility.
    } finally {
      retire(record)
    }
  }, { global: true }))

  disposers.push(ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end' || event.type === 'turn/start') {
      // Epochs invalidate completed-call evidence too, without retaining agents.
      turnEpochs.set(session, (turnEpochs.get(session) ?? 0) + 1)
      versions.set(session, (versions.get(session) ?? 0) + 1)
    } else if (['user/message', 'system/message', 'developer/message', 'sandbox/mode',
      'approval/policy', 'working-directory/change', 'subagent/descriptor'].includes(event.type) ||
        (event.surfaceOp && event.surfaceOp !== 'append')) {
      versions.set(session, (versions.get(session) ?? 0) + 1)
    }
  }, { global: true }))

  disposers.push(ctx.on('session/disposed', (session) => {
    for (const record of records) {
      if (record.exec.agent.session === session) retire(record)
    }
    versions.set(session, (versions.get(session) ?? 0) + 1)
  }, { global: true }))

  disposers.push(ctx.on('approval/request', async (request, next) => {
    const record = request.agent && unique(request.agent, request.callId)
    if (!record) return next()
    const started = Date.now()
    let policy
    let cwd
    let eligible = false
    try {
      policy = policyFor(ctx, request.agent)
      cwd = directoryFor(ctx, request.agent)
      eligible = identifyEscalation(request, record, policy, cwd) &&
        definitionFor(ctx, record.exec) === record.definition
    } catch {
      // Keep delegation outside the inspection try, so a throwing next is never retried.
    }
    if (!eligible) return next()
    const callerSignal = AbortSignal.any([record.exec.signal, ...(request.signal ? [request.signal] : [])])
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(new Error('review-timeout')), config.timeoutMs)
    const signal = AbortSignal.any([callerSignal, record.lifetime.signal, lifetime.signal, deadline.signal])
    const session = request.agent.session
    const version = versions.get(session) ?? 0
    let humanPromise
    const fallback = async (result) => {
      clearTimeout(timer)
      log(request, result, started)
      if (callerSignal.aborted || lifetime.signal.aborted || record.closed) return 'cancelled'
      if (never(ctx, request.agent)) return 'rejected'
      // A rejecting terminal answerer must not make our catch block invoke next twice.
      humanPromise ??= Promise.resolve().then(next)
      return humanPromise
    }
    try {
      if (callerSignal.aborted || lifetime.signal.aborted) return 'cancelled'
      if (never(ctx, request.agent)) return 'rejected'
      const key = operationKey(record.exec.name, record.exec.arguments, policy, cwd)
      const journal = denials.get(request.agent)
      const evidence = journal?.has(key) && journal.get(key) === (turnEpochs.get(session) ?? 0)
      // Each observed denial is evidence for at most one retry, even with concurrent calls.
      journal?.delete(key)
      if (!evidence) return await fallback({ decision: 'human', code: 'missing-retry-evidence' })
      const snapshot = await abortable(service(ctx, request.agent, 'sessionQuery').readSurface(session.id), signal)
      if (snapshot.session.id !== session.id) throw new Error('wrong-session')
      const schema = record.exec.schema ?? record.definition
      const state = buildState(request, record, policy, cwd, schema, snapshot, evidence)
      const result = await abortable(review(state, signal), signal)
      if (callerSignal.aborted || lifetime.signal.aborted || record.closed) return 'cancelled'
      if (never(ctx, request.agent)) return 'rejected'
      if ((versions.get(session) ?? 0) !== version ||
          !identifyEscalation(request, record, policyFor(ctx, request.agent), directoryFor(ctx, request.agent)) ||
          definitionFor(ctx, record.exec) !== record.definition) {
        return await fallback({ decision: 'human', code: 'stale-context' })
      }
      if (result?.decision === 'allow' || result?.decision === 'reject') {
        log(request, result, started)
        return result.decision === 'allow' ? 'allowed-once' : 'rejected'
      }
      return await fallback(result ?? { decision: 'human', code: 'invalid-response' })
    } catch (error) {
      // Only fixed local diagnostic codes may cross the log boundary, never
      // arbitrary exception messages or raw snapshot/service details.
      const contextCode = ['unsupported-context', 'incomplete-authority', 'unknown-directory',
        'unknown-tool-schema', 'wrong-session'].includes(error?.message) ? error.message : 'review-failed'
      return await fallback({ decision: 'human', code: deadline.signal.aborted ? 'review-timeout' : contextCode })
    } finally {
      clearTimeout(timer)
    }
  }, { global: true, prepend: true }))

  ctx.effect(() => () => {
    lifetime.abort(new Error('reviewer-unloaded'))
    for (const record of records) retire(record)
    for (const dispose of disposers) dispose()
  })
}

export function apply(ctx, rawConfig = {}) {
  installReviewer(ctx, rawConfig)
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
