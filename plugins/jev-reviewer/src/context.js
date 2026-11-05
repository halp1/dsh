import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

const MODES = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}
const TOOLS = new Set(['bash', 'pwsh', 'write', 'edit', 'str_replace_editor', 'run_code'])

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

/** Recognize only the tested host's actual escalation protocol, not a prose prefix. */
export function identifyEscalation(request, record, policy, cwd) {
  if (!record || !record.active || record.closed || !supportedTool(request.toolName)) return false
  const exec = record.exec
  const args = exec.arguments
  if (request.agent !== exec.agent || request.callId !== exec.callId || request.toolName !== exec.name) return false
  if (!isRecord(args) || !MODES[policy?.mode]?.includes(args.sandbox_permissions)) return false
  if (typeof args.justification !== 'string' || !args.justification.trim()) return false
  if (request.reason !== `escalate sandbox to ${args.sandbox_permissions}: ${args.justification}`) return false
  if (JSON.stringify(record.policy) !== JSON.stringify(policy) || record.cwd !== cwd) return false
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
        'sandbox-policy', 'working-directory', 'tool-registry', 'ptc-mode', 'subagent-settled'].includes(source.kind)) {
        limited = true
      }
      continue
    }
    const text = []
    for (const block of content) {
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
  const directory = args.workdir === undefined ? cwd :
    typeof args.workdir === 'string' ? resolve(cwd, args.workdir) : undefined
  if (!directory) throw new Error('unknown-directory')
  return {
    policyVersion: 1,
    policy: {
      standingMode: policy.mode,
      requestedMode: args.sandbox_permissions,
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
    evidence: { exactSameTurnSandboxDenial: retryEvidence === true },
  }
}
