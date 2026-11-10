/**
 * Keep the plugin's Claude accounts in step with every Claude Code login on
 * this machine.
 *
 * Each Claude Code store (the default Keychain item, one per extra
 * `CLAUDE_CONFIG_DIR`, and credentials files) holds at most one login. A sync
 * pass imports every login it finds as its own account, keyed by the account
 * email so the same person never lands twice, and binds the account to the
 * store it came from so refreshes flow both ways. Accounts stored under a
 * token-hash key from older imports are moved to their email key, with the
 * old key kept as an alias.
 *
 * Logging an imported account out records its store as dismissed for that
 * identity, so the next pass does not bring it straight back. A different
 * login appearing in that store later is imported as usual.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  claudeCodeSourceId,
  sourceOf,
  type ClaudeCodeCredentialStore,
  type ClaudeIdentify,
} from './claude-code-creds.js'
import type { AccountEntry, ClaudeCodeSource, ClaudeSession } from './store.js'

/** Account storage the sync needs, injectable for tests. */
export interface ClaudeAccountIo {
  list(): Promise<AccountEntry<ClaudeSession>[]>
  /** Atomic read-modify-write of one account; `update` returning undefined skips the write. */
  update(account: string, update: (current: ClaudeSession | undefined) => ClaudeSession | undefined): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
}

/** Dismissed stores: source id to the identity that was logged out of it. */
export interface DismissalIo {
  load(): Promise<Record<string, string>>
  save(dismissed: Record<string, string>): Promise<void>
}

export interface ClaudeCodeSyncOptions {
  store: ClaudeCodeCredentialStore
  identify: ClaudeIdentify
  accounts: ClaudeAccountIo
  dismissals?: DismissalIo
  /**
   * OAuth refresh for a discovered login whose access token already expired
   * (the CLI has not run since). The rotated token is written back to its store.
   */
  refresh?: (session: ClaudeSession) => Promise<ClaudeSession>
}

/** What one sync pass changed, by account key. */
export interface ClaudeCodeSyncResult {
  imported: string[]
  updated: string[]
  renamed: Array<{ from: string, to: string }>
  /** Usable Claude Code logins found, whether or not anything changed. */
  seen: number
}

function lower(email: string): string {
  return email.trim().toLowerCase()
}

function tokenFingerprint(refreshToken: string): string {
  return `token:${createHash('sha256').update(refreshToken).digest('hex').slice(0, 16)}`
}

function sameSource(left: ClaudeCodeSource | undefined, right: ClaudeCodeSource): boolean {
  return left !== undefined && claudeCodeSourceId(left) === claudeCodeSourceId(right)
}

export class ClaudeCodeSync {
  /** Access token to email, so an unchanged login is never looked up twice. */
  private readonly identities = new Map<string, string | undefined>()
  private running: Promise<ClaudeCodeSyncResult> | undefined

  constructor(private readonly options: ClaudeCodeSyncOptions) {}

  /**
   * Run one pass, joining a pass already in flight.
   * @param overrideDismissals - an explicit Import click: bring back logins
   *   the user logged out of earlier, and forget those dismissals.
   */
  async sync(overrideDismissals = false): Promise<ClaudeCodeSyncResult> {
    if (overrideDismissals) {
      await this.running?.catch(() => undefined)
      await this.options.dismissals?.save({})
    }
    this.running ??= this.pass().finally(() => { this.running = undefined })
    return this.running
  }

  /**
   * Record that the user logged an account out, so its store is not
   * re-imported until a different login appears there.
   */
  async dismiss(session: ClaudeSession): Promise<void> {
    const source = sourceOf(session)
    if (source === undefined || this.options.dismissals === undefined) return
    const dismissed = await this.options.dismissals.load()
    dismissed[claudeCodeSourceId(source)] = session.emailAddress === undefined
      ? tokenFingerprint(session.refreshToken)
      : lower(session.emailAddress)
    await this.options.dismissals.save(dismissed)
  }

  private async identify(accessToken: string): Promise<string | undefined> {
    if (this.identities.has(accessToken)) return this.identities.get(accessToken)
    const email = await this.options.identify(accessToken).catch(() => undefined)
    // Only cache answers: a failed lookup is retried on the next pass.
    if (email !== undefined) this.identities.set(accessToken, email)
    return email
  }

  private async pass(): Promise<ClaudeCodeSyncResult> {
    const result: ClaudeCodeSyncResult = { imported: [], updated: [], renamed: [], seen: 0 }
    const { accounts } = this.options
    await this.labelLegacyAccounts(result)

    const dismissed = await this.options.dismissals?.load() ?? {}
    for (const discovered of this.options.store.discover()) {
      const { source } = discovered
      const sourceId = claudeCodeSourceId(source)
      const entries = await accounts.list()
      const found = await this.live(discovered.session, source, entries)
      if (found === undefined) continue
      result.seen++
      // The same login already stored (rotation not yet happened): just bind it.
      const known = entries.find(({ session }) =>
        session.refreshToken === found.refreshToken || session.accessToken === found.accessToken)
      let email = known?.session.emailAddress
      if (email === undefined) email = await this.identify(found.accessToken)
      if (dismissed[sourceId] !== undefined) {
        const identity = email === undefined ? tokenFingerprint(found.refreshToken) : lower(email)
        if (dismissed[sourceId] === identity) continue
      }
      if (email === undefined) continue

      const owner = known ?? entries.find(({ session }) =>
        session.emailAddress !== undefined && lower(session.emailAddress) === lower(email))
      if (owner === undefined) {
        const session: ClaudeSession = {
          ...found,
          emailAddress: email,
          keychainBound: true,
          claudeCodeSource: source,
        }
        if (await accounts.update(email, current => current === undefined ? session : undefined)) {
          result.imported.push(email)
        }
        continue
      }

      const bound = owner.session.claudeCodeSource
      if (bound !== undefined && !sameSource(bound, source) && this.options.store.read(bound) !== undefined) continue
      let next: ClaudeSession | undefined
      const changed = await accounts.update(owner.key, (current) => {
        if (current === undefined) return undefined
        const fresher = found.expiresAt > current.expiresAt
        const needsBinding = current.claudeCodeSource === undefined || !sameSource(current.claudeCodeSource, source)
        if (!fresher && !needsBinding && current.emailAddress !== undefined) return undefined
        next = {
          ...current,
          ...fresher
            ? { accessToken: found.accessToken, refreshToken: found.refreshToken, expiresAt: found.expiresAt, scopes: found.scopes }
            : {},
          emailAddress: current.emailAddress ?? email,
          ...current.subscriptionType === undefined && found.subscriptionType !== undefined
            ? { subscriptionType: found.subscriptionType }
            : {},
          keychainBound: true,
          claudeCodeSource: source,
        }
        return next
      })
      if (!changed || next === undefined) continue
      result.updated.push(owner.key)
      await this.rekey(owner.key, next, result)
    }
    return result
  }

  /**
   * A discovered login with a usable access token. One that expired is
   * refreshed (unless the plugin already holds the same login) and the
   * rotation written back, so the CLI using that store keeps working.
   */
  private async live(
    found: ClaudeSession,
    source: ClaudeCodeSource,
    entries: AccountEntry<ClaudeSession>[],
  ): Promise<ClaudeSession | undefined> {
    if (found.expiresAt > Date.now() + 60_000) return found
    if (entries.some(({ session }) => session.refreshToken === found.refreshToken)) return found
    if (this.options.refresh === undefined) return undefined
    try {
      const next = await this.options.refresh(found)
      this.options.store.writeBack(source, next, found.accessToken)
      return next
    } catch {
      return undefined
    }
  }

  /** Give accounts stored without an email one, and move them to their email key. */
  private async labelLegacyAccounts(result: ClaudeCodeSyncResult): Promise<void> {
    for (const { key, session } of await this.options.accounts.list()) {
      if (session.emailAddress !== undefined) {
        await this.rekey(key, session, result)
        continue
      }
      if (session.expiresAt <= Date.now()) continue
      const email = await this.identify(session.accessToken)
      if (email === undefined) continue
      let next: ClaudeSession | undefined
      const changed = await this.options.accounts.update(key, current =>
        current === undefined || current.emailAddress !== undefined ? undefined : (next = { ...current, emailAddress: email }))
      if (!changed || next === undefined) continue
      result.updated.push(key)
      await this.rekey(key, next, result)
    }
  }

  private async rekey(key: string, session: ClaudeSession, result: ClaudeCodeSyncResult): Promise<void> {
    const email = session.emailAddress
    if (email === undefined || key === email || !key.startsWith('token-')) return
    if (await this.options.accounts.rename(key, email)) result.renamed.push({ from: key, to: email })
  }
}

/** Dismissals persisted next to the auth store. */
export function fileDismissals(path = dshHomePath('plugins', 'subscriptions', 'claude-code-dismissed.json')): DismissalIo {
  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
        return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string>
      } catch {
        return {}
      }
    },
    async save(dismissed) {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.tmp-${process.pid}`
      try {
        await writeFile(tmp, JSON.stringify(dismissed, null, 2), { mode: 0o600 })
        await rename(tmp, path)
      } catch (error) {
        await rm(tmp, { force: true })
        throw error
      }
    },
  }
}
