/**
 * Claude Code credential stores, read and written as the `claude` CLI does.
 *
 * Claude Code keeps one OAuth login per config directory. On macOS each lives
 * in a Keychain item: `Claude Code-credentials` for the default directory and
 * `Claude Code-credentials-<hash>` for a `CLAUDE_CONFIG_DIR`, where `<hash>` is
 * the first eight hex digits of SHA-256 over the variable's raw value. The CLI
 * looks the item up under the login user name. Elsewhere, or when the Keychain
 * is unavailable, the login sits in `<config dir>/.credentials.json`.
 *
 * A {@link ClaudeCodeSource} names one such store, so several Claude Code
 * logins can each be imported as their own account and stay synced with the
 * store they came from.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import type { ClaudeCodeSource, ClaudeSession } from './store.js'

const SECURITY = '/usr/bin/security'
const PRIMARY_SERVICE = 'Claude Code-credentials'
const SERVICE_PATTERN = /^Claude Code-credentials(?:-[0-9a-f]{8})?$/
const CLI_ACCOUNT_PATTERN = /^[a-zA-Z0-9._-]+$/

interface RawCreds {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scopes?: string[] | string
  subscriptionType?: string
  emailAddress?: string
}

interface CredentialBlob extends RawCreds {
  claudeAiOauth?: RawCreds
}

const DEFAULT_SCOPES = 'user:profile user:inference user:sessions:claude_code user:mcp_servers'

function toSession(data: RawCreds): ClaudeSession | undefined {
  // Empty-string tokens (seen from a corrupted Keychain item left by a Claude
  // Code logout) pass the typeof gate but are useless and would poison the
  // auth store: a single such entry fails every provider's status read.
  if (typeof data.accessToken !== 'string' || data.accessToken.length === 0
    || typeof data.refreshToken !== 'string' || data.refreshToken.length === 0
    || typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt)) {
    return undefined
  }
  const scopes = Array.isArray(data.scopes) ? data.scopes.join(' ') : typeof data.scopes === 'string' ? data.scopes : DEFAULT_SCOPES
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Math.trunc(data.expiresAt),
    scopes,
    ...typeof data.emailAddress === 'string' ? { emailAddress: data.emailAddress } : {},
    ...typeof data.subscriptionType === 'string' ? { subscriptionType: data.subscriptionType } : {},
  }
}

/** Parse one stored credential blob, with or without the `claudeAiOauth` wrapper. */
export function parseClaudeCodeBlob(raw: string): ClaudeSession | undefined {
  let parsed: CredentialBlob
  try {
    parsed = JSON.parse(raw) as CredentialBlob
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  return toSession(parsed.claudeAiOauth ?? parsed)
}

/** The Keychain account name Claude Code files its items under. */
export function claudeCodeKeychainAccount(): string {
  let name: string
  try {
    name = process.env.USER || userInfo().username
  } catch {
    name = 'claude-code-user'
  }
  return CLI_ACCOUNT_PATTERN.test(name) ? name : 'claude-code-user'
}

/** The Keychain service Claude Code uses for one `CLAUDE_CONFIG_DIR` value (undefined: the default dir). */
export function claudeCodeKeychainService(configDir?: string): string {
  if (configDir === undefined || configDir === '') return PRIMARY_SERVICE
  const hash = createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)
  return `${PRIMARY_SERVICE}-${hash}`
}

/** Stable identity of a source, for binding accounts and recording dismissals. */
export function claudeCodeSourceId(source: ClaudeCodeSource): string {
  return source.kind === 'keychain' ? `keychain:${source.service}:${source.account}` : `file:${source.path}`
}

/** The source Claude Code's default config directory uses on this platform. */
export function defaultClaudeCodeSource(): ClaudeCodeSource {
  if (process.platform === 'darwin') {
    return { kind: 'keychain', service: PRIMARY_SERVICE, account: claudeCodeKeychainAccount() }
  }
  return { kind: 'file', path: credentialsFilePath(process.env.CLAUDE_CONFIG_DIR) }
}

/**
 * The source an imported session syncs with. Sessions imported before
 * sources were recorded carry only `keychainBound`, and came from the default
 * store.
 */
export function sourceOf(session: ClaudeSession): ClaudeCodeSource | undefined {
  if (session.claudeCodeSource !== undefined) return session.claudeCodeSource
  return session.keychainBound === true ? defaultClaudeCodeSource() : undefined
}

function credentialsFilePath(configDir?: string): string {
  return join(configDir ?? join(homedir(), '.claude'), '.credentials.json')
}

/** Expand a leading `~` the way a shell would before Claude Code saw the value. */
function expandHome(dir: string): string {
  return dir === '~' ? homedir() : dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir
}

/** Shell-free command runner, injectable so tests never touch the real Keychain. */
export type SecurityRunner = (args: readonly string[], input?: { timeout?: number }) => string | undefined

const runSecurity: SecurityRunner = (args, input) => {
  try {
    return execFileSync(SECURITY, args, {
      timeout: input?.timeout ?? 3000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch {
    return undefined
  }
}

/**
 * Pull every Claude Code item out of `security dump-keychain` attribute
 * output (no secrets are printed without `-d`).
 */
export function parseKeychainDump(dump: string): ClaudeCodeSource[] {
  const sources: ClaudeCodeSource[] = []
  const seen = new Set<string>()
  for (const block of dump.split(/^keychain: /m)) {
    if (!/^class: "genp"/m.test(block)) continue
    const service = /"svce"<blob>="([^"]*)"/.exec(block)?.[1]
    const account = /"acct"<blob>="([^"]*)"/.exec(block)?.[1]
    if (service === undefined || account === undefined || !SERVICE_PATTERN.test(service)) continue
    const source: ClaudeCodeSource = { kind: 'keychain', service, account }
    const id = claudeCodeSourceId(source)
    if (seen.has(id)) continue
    seen.add(id)
    sources.push(source)
  }
  return sources
}

/** One Claude Code login found on this machine. */
export interface DiscoveredClaudeCredential {
  source: ClaudeCodeSource
  session: ClaudeSession
}

export interface ClaudeCodeStoreOptions {
  /** Extra Claude Code config directories whose `.credentials.json` should be read. */
  configDirs?: readonly string[]
  /** Test seam for `/usr/bin/security`. */
  security?: SecurityRunner
  /** Platform override for tests. */
  platform?: NodeJS.Platform
}

/** Read and write Claude Code's credential stores. */
export class ClaudeCodeCredentialStore {
  private readonly security: SecurityRunner
  private readonly platform: NodeJS.Platform

  constructor(private readonly options: ClaudeCodeStoreOptions = {}) {
    this.security = options.security ?? runSecurity
    this.platform = options.platform ?? process.platform
  }

  /** Every source that could hold a login, Keychain items first. */
  sources(): ClaudeCodeSource[] {
    const sources: ClaudeCodeSource[] = []
    if (this.platform === 'darwin') {
      const dump = this.security(['dump-keychain'], { timeout: 5000 })
      if (dump !== undefined) sources.push(...parseKeychainDump(dump))
    }
    const dirs = [undefined, process.env.CLAUDE_CONFIG_DIR, ...this.options.configDirs ?? []]
    const paths = new Set(dirs.map(dir => credentialsFilePath(dir === undefined || dir === '' ? undefined : expandHome(dir))))
    for (const path of paths) sources.push({ kind: 'file', path })
    return sources
  }

  /** Read one source's login, if it holds a usable one. */
  read(source: ClaudeCodeSource): ClaudeSession | undefined {
    const raw = this.readRaw(source)
    return raw === undefined ? undefined : parseClaudeCodeBlob(raw)
  }

  /** Every usable login on this machine, one per source. */
  discover(): DiscoveredClaudeCredential[] {
    const found: DiscoveredClaudeCredential[] = []
    for (const source of this.sources()) {
      const session = this.read(source)
      if (session !== undefined) found.push({ source, session })
    }
    return found
  }

  /**
   * Write a refreshed session back to the source it was imported from, so the
   * `claude` CLI using that store sees the token just rotated. A blob that no
   * longer holds the expected prior token means something else rotated it
   * first. That is a no-op, and the next read picks the newer token up.
   * @param source - the store to update.
   * @param next - the freshly refreshed session.
   * @param expectedPriorAccessToken - the access token the refresh started from.
   * @returns whether the write landed.
   */
  writeBack(source: ClaudeCodeSource, next: ClaudeSession, expectedPriorAccessToken: string): boolean {
    const raw = this.readRaw(source)
    if (raw === undefined || parseClaudeCodeBlob(raw)?.accessToken !== expectedPriorAccessToken) return false
    const updated = mergeIntoBlob(raw, next)
    if (updated === undefined) return false
    if (source.kind === 'keychain') {
      return this.security(
        ['add-generic-password', '-U', '-s', source.service, '-a', source.account, '-w', updated],
        { timeout: 2000 },
      ) !== undefined
    }
    try {
      const dir = dirname(source.path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(source.path, updated, { encoding: 'utf8', mode: 0o600 })
      chmodSync(source.path, 0o600)
      return true
    } catch {
      return false
    }
  }

  private readRaw(source: ClaudeCodeSource): string | undefined {
    if (source.kind === 'keychain') {
      if (this.platform !== 'darwin') return undefined
      return this.security(['find-generic-password', '-s', source.service, '-a', source.account, '-w'])?.trim()
    }
    try {
      return readFileSync(source.path, 'utf8')
    } catch {
      return undefined
    }
  }
}

/** Merge fresh tokens into an existing raw blob, preserving unrelated fields. */
function mergeIntoBlob(existingRaw: string, next: ClaudeSession): string | undefined {
  let parsed: CredentialBlob
  try {
    parsed = JSON.parse(existingRaw) as CredentialBlob
  } catch {
    return undefined
  }
  const target: RawCreds = parsed.claudeAiOauth ?? parsed
  target.accessToken = next.accessToken
  target.refreshToken = next.refreshToken
  target.expiresAt = next.expiresAt
  return JSON.stringify(parsed)
}

const defaultStore = new ClaudeCodeCredentialStore()

/**
 * Read the default Claude Code login: the default Keychain item, falling back
 * to the default credentials file.
 */
export function readClaudeCodeCredentials(): ClaudeSession | undefined {
  const keychain = defaultClaudeCodeSource()
  const fromDefault = defaultStore.read(keychain)
  if (fromDefault !== undefined || keychain.kind === 'file') return fromDefault
  return defaultStore.read({ kind: 'file', path: credentialsFilePath(process.env.CLAUDE_CONFIG_DIR) })
}

/** Resolve the email a Claude access token belongs to; undefined when unknown. */
export type ClaudeIdentify = (accessToken: string) => Promise<string | undefined>

function sameIdentity(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase()
}

/**
 * Refresh an imported Claude session against its own Claude Code store.
 *
 * The store may already hold a fresher token (the `claude` CLI rotated it).
 * That token is adopted only when it still belongs to the same account: a
 * `/login` to a different account in that config dir must not relabel this
 * one. A store that switched accounts detaches this session, which then
 * refreshes standalone, and the next sync imports the new login.
 * @param session - the session TokenManager wants refreshed.
 * @param doRefresh - the OAuth refresh-token grant.
 * @param store - the Claude Code credential stores.
 * @param identify - resolves a token's account email (profile lookup).
 * @returns the freshest available session.
 */
export async function refreshClaudeSynced(
  session: ClaudeSession,
  doRefresh: (session: ClaudeSession) => Promise<ClaudeSession>,
  store: ClaudeCodeCredentialStore = defaultStore,
  identify?: ClaudeIdentify,
): Promise<ClaudeSession> {
  const source = sourceOf(session)
  if (source === undefined) return doRefresh(session)
  const fromSource = store.read(source)
  let base = session
  if (fromSource !== undefined && fromSource.accessToken !== session.accessToken) {
    const owner = session.emailAddress === undefined || identify === undefined
      ? session.emailAddress
      : await identify(fromSource.accessToken).catch(() => undefined)
    if (session.emailAddress === undefined || sameIdentity(owner, session.emailAddress)) {
      base = { ...session, accessToken: fromSource.accessToken, refreshToken: fromSource.refreshToken, expiresAt: fromSource.expiresAt }
    } else if (owner !== undefined) {
      return detach(await doRefresh(session))
    }
  }
  if (base.expiresAt > Date.now() + 60_000) return base
  const next = { ...await doRefresh(base), keychainBound: true, claudeCodeSource: source }
  store.writeBack(source, next, base.accessToken)
  return next
}

/** Drop a session's binding to its Claude Code store. */
export function detach(session: ClaudeSession): ClaudeSession {
  const { keychainBound: _bound, claudeCodeSource: _source, ...rest } = session
  return rest
}
