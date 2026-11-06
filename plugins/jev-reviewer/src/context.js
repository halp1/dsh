import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

const MODES = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}
const TOOLS = new Set(['bash', 'pwsh', 'write', 'edit', 'str_replace_editor', 'run_code', 'plugin_manager'])
const PLUGIN_QUERIES = new Set(['list_plugins', 'list_bundles', 'list_version_exemptions'])

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Stable identity for an operation, never a persistent permission or command log. */
export function operationKey(name, args, policy, cwd) {
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]))
  }
  const operation = Object.fromEntries(Object.entries(args).filter(([key]) =>
    !['description', 'sandbox_permissions', 'justification'].includes(key)))
  return createHash('sha256').update(JSON.stringify(ordered({ name, operation, policy, cwd }))).digest('hex')
}

export function supportedTool(name) {
  return TOOLS.has(name)
}

/** Closed read-only subset. Never generalize this to installation or other profile mutations. */
export function readOnlyPluginQuery(name, args) {
  if (name !== 'plugin_manager' || !isRecord(args) || !Object.hasOwn(args, 'action') ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(args))) return false
  const keys = Reflect.ownKeys(args)
  if (keys.some((key) => typeof key !== 'string' || !['action', 'offset', 'limit'].includes(key) ||
      !Object.getOwnPropertyDescriptor(args, key).enumerable ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(args, key), 'value'))) return false
  if (!PLUGIN_QUERIES.has(args.action)) return false
  if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0)) return false
  if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 100)) return false
  return true
}

/** Recognize only the tested host's actual escalation protocol, not a prose prefix. */
export function identifyEscalation(request, record, policy, cwd) {
  if (!record || !record.active || record.closed || !supportedTool(request.toolName)) return false
  const exec = record.exec
  const args = exec.arguments
  if (request.agent !== exec.agent || request.callId !== exec.callId || request.toolName !== exec.name) return false
  if (JSON.stringify(record.policy) !== JSON.stringify(policy) || record.cwd !== cwd) return false
  if (request.toolName === 'plugin_manager') {
    // The native query gate asks directly, without first running a failing sandboxed command.
    // Bind the full observed gate format to the immutable, closed read-only arguments.
    return MODES[policy?.mode]?.includes('danger-full-access') === true &&
      readOnlyPluginQuery(exec.name, args) && request.reason ===
      `escalate sandbox to danger-full-access: plugin_manager ${JSON.stringify(args)}. Profile changes persist across sessions${String.fromCharCode(59)} installed Host code runs outside the workspace sandbox.`
  }
  if (!isRecord(args) || !MODES[policy?.mode]?.includes(args.sandbox_permissions)) return false
  if (typeof args.justification !== 'string' || !args.justification.trim()) return false
  if (request.reason !== `escalate sandbox to ${args.sandbox_permissions}: ${args.justification}`) return false
  return true
}

/** Never accept a sandbox marker printed by a command as proof of a denial. */
export function sandboxDenied(result, mode) {
  if (result?.isError === true) return result.error?.info?.code === 'FS_SANDBOX_DENIED'
  const sandbox = result?.value?.sandbox
  return sandbox?.denied === true && sandbox?.mode === mode && sandbox?.runnerFailed !== true
}

/** Keep direct human authority distinct from model-authored child creation prompts. */
export function instructionContext(snapshot) {
  if (!isRecord(snapshot?.session) || !Array.isArray(snapshot.events)) throw new Error('unsupported-context')
  const instructions = []
  let directUser = false
  let limited = false
  for (const event of snapshot.events) {
    if (!['user/message', 'system/message', 'developer/message'].includes(event.type)) continue
    const message = event.type === 'user/message' ? event.data : event.data?.message
    const source = message?.source
    const content = message?.content
    if (!isRecord(source) || !Array.isArray(content)) throw new Error('unsupported-context')
    let role = 'fact'
    if (event.type === 'system/message') {
      role = 'system-constraint'
    } else if (event.type === 'developer/message') {
      role = 'developer-constraint'
    } else if (source.kind === 'user') {
      // Inherited creation prompts have no transport marker either. Rather than
      // upgrading an ambiguous fork's text, leave the entire fork for a human.
      if (snapshot.session.isSeeded) limited = true
      role = snapshot.session.origin === 'subagent' && typeof source.rpcId !== 'string'
        ? 'direct-parent' : 'direct-user'
    } else if (['agent-instructions', 'skill-invocation'].includes(source.kind)) {
      role = 'constraint'
    } else if (source.kind === 'skill-catalog') {
      // A normal session always carries this producer. Keep its use requirements
      // as restrictions, never as permission supplied by a catalog description.
      if (source.form !== 'catalog' || source.incomplete === true || !Array.isArray(source.entries) ||
          source.entries.some((entry) => !isRecord(entry) || typeof entry.name !== 'string' || typeof entry.description !== 'string')) {
        limited = true
      }
      role = 'constraint'
    } else if (['plan-mode', 'action-cards', 'user-question-reply'].includes(source.kind)) {
      // Mode/card notices and question answers can narrow a task, not authorize
      // an escalation. In particular, a missing/empty answer never means consent.
      role = 'constraint'
    } else if (source.kind === 'agent-message' && snapshot.session.origin === 'subagent' &&
        source.senderSessionId === snapshot.session.parentSession) {
      role = 'direct-parent'
    } else if (source.kind === 'compact-checkpoint') {
      role = 'checkpoint'
      limited = true
    } else {
      // Unknown producers might carry restrictions. Never silently discard them.
      // These known runtime notices and tool facts cannot grant authority.
      if (!['tool', 'runtime-context', 'time-context', 'tmux-context', 'user-approval',
        'sandbox-policy', 'working-directory', 'tool-registry', 'ptc-mode', 'subagent-settled',
        'agent-message', 'model-selection'].includes(source.kind)) {
        limited = true
      }
      continue
    }
    const text = []
    for (const block of content) {
      // Current DSH emits structural tool changes in developer messages. They
      // are not missing prose instructions. The pending tool's live schema is
      // independently bound in buildState and rechecked before a grant.
      if (event.type === 'developer/message' && source.kind === 'tool-registry' &&
          ['tool-addition', 'tool-removal'].includes(block?.type) &&
          typeof block.toolName === 'string' && block.toolName.trim()) continue
      if (block?.type !== 'text' || typeof block.text !== 'string') {
        limited = true
        continue
      }
      text.push(block.text)
    }
    if (!text.length) continue
    if (role === 'direct-user') directUser = true
    instructions.push({ role, text })
  }
  if (!directUser || limited) throw new Error('incomplete-authority')
  return instructions
}

/** No filesystem reads or source execution occur while constructing reviewer state. */
export function buildState(request, record, policy, cwd, schema, snapshot, retryEvidence) {
  if (!isAbsolute(cwd) || !isAbsolute(policy.workspaceRoot)) throw new Error('unknown-directory')
  if (!schema || schema.name !== record.exec.name || typeof schema.description !== 'string' ||
      !isRecord(schema.parameters)) throw new Error('unknown-tool-schema')
  const args = record.exec.arguments
  const pluginQuery = readOnlyPluginQuery(record.exec.name, args)
  const directory = args.workdir === undefined ? cwd :
    typeof args.workdir === 'string' ? resolve(cwd, args.workdir) : undefined
  if (!directory) throw new Error('unknown-directory')
  return {
    policyVersion: 2,
    policy: {
      standingMode: policy.mode,
      requestedMode: pluginQuery ? 'danger-full-access' : args.sandbox_permissions,
      workspaceRoot: policy.workspaceRoot,
      additionalWritableRoots: policy.additionalWritableRoots ?? [],
    },
    operation: {
      tool: request.toolName,
      arguments: args,
      workingDirectory: cwd,
      commandDirectory: directory,
      schema: { name: schema.name, description: schema.description, parameters: schema.parameters },
    },
    instructions: instructionContext(snapshot),
    evidence: { exactSameTurnSandboxDenial: retryEvidence === true, readOnlyPluginQuery: pluginQuery },
  }
}
