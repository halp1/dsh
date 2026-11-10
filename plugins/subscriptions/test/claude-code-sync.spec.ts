/**
 * Multi-login Claude Code import: store naming that must match the `claude`
 * CLI, Keychain discovery and write-back routing, and the sync that turns
 * every login into its own email-keyed account.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClaudeCodeCredentialStore,
  claudeCodeKeychainService,
  parseKeychainDump,
  refreshClaudeSynced,
  type SecurityRunner,
} from '../src/auth/claude-code-creds.js'
import { ClaudeCodeSync, type ClaudeAccountIo, type DismissalIo } from '../src/auth/claude-code-sync.js'
import { getAccountSession, listAccounts, renameAccount, resolveAccountKey, saveAccountSession } from '../src/auth/store.js'
import type { AccountEntry, ClaudeCodeSource, ClaudeSession } from '../src/auth/store.js'

const HOUR = 3600_000

function blob(accessToken: string, refreshToken: string, expiresAt = Date.now() + HOUR): string {
  return JSON.stringify({
    mcpOAuth: { other: { accessToken: 'mcp-token' } },
    claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes: ['user:inference', 'user:profile'], subscriptionType: 'max' },
  })
}

/** An in-memory login Keychain answering the `security` calls the store makes. */
class FakeKeychain {
  items = new Map<string, { service: string, account: string, secret: string }>()
  calls: string[][] = []

  put(service: string, account: string, secret: string): void {
    this.items.set(`${service}\u0000${account}`, { service, account, secret })
  }

  get(service: string, account: string): string | undefined {
    return this.items.get(`${service}\u0000${account}`)?.secret
  }

  readonly run: SecurityRunner = (args) => {
    this.calls.push([...args])
    const flag = (name: string) => args[args.indexOf(name) + 1]
    switch (args[0]) {
      case 'dump-keychain':
        return [...this.items.values(), { service: 'Claude Safe Storage', account: 'Claude Key', secret: '' }]
          .map(({ service, account }) => [
            'keychain: "/Users/test/Library/Keychains/login.keychain-db"',
            'version: 512',
            'class: "genp"',
            'attributes:',
            `    "acct"<blob>="${account}"`,
            `    "svce"<blob>="${service}"`,
          ].join('\n')).join('\n') + '\n'
      case 'find-generic-password':
        return this.get(flag('-s'), flag('-a'))
      case 'add-generic-password':
        this.put(flag('-s'), flag('-a'), flag('-w'))
        return ''
      default:
        return undefined
    }
  }
}

function darwinStore(keychain: FakeKeychain): ClaudeCodeCredentialStore {
  return new ClaudeCodeCredentialStore({ security: keychain.run, platform: 'darwin' })
}

/** Account storage held in memory, with the alias behavior of the real store. */
function memoryAccounts(): ClaudeAccountIo & { map: Map<string, ClaudeSession>, aliases: Map<string, string> } {
  const map = new Map<string, ClaudeSession>()
  const aliases = new Map<string, string>()
  return {
    map,
    aliases,
    list: async (): Promise<AccountEntry<ClaudeSession>[]> => [...map].map(([key, session]) => ({ key, session })),
    update: async (key, update) => {
      const resolved = aliases.get(key) ?? key
      const next = update(map.get(resolved))
      if (next === undefined) return false
      map.set(resolved, next)
      return true
    },
    rename: async (from, to) => {
      const session = map.get(from)
      if (session === undefined) return false
      map.delete(from)
      if (!map.has(to)) map.set(to, session)
      aliases.set(from, to)
      return true
    },
  }
}

function memoryDismissals(): DismissalIo & { value: Record<string, string> } {
  const io = {
    value: {} as Record<string, string>,
    load: async () => ({ ...io.value }),
    save: async (next: Record<string, string>) => { io.value = { ...next } },
  }
  return io
}

const EMAILS: Record<string, string> = {
  'at-personal': 'me@example.com',
  'at-personal-2': 'me@example.com',
  'at-work': 'me@work.example',
  'at-other': 'someone-else@example.com',
}
const identify = async (accessToken: string) => EMAILS[accessToken]

test('Keychain service names match what the claude CLI looks up', () => {
  // Captured from Claude Code 2.1.316 with a stub `security` on PATH: the
  // hash covers the raw CLAUDE_CONFIG_DIR value, so it is a protocol literal.
  assert.equal(claudeCodeKeychainService(), 'Claude Code-credentials')
  assert.equal(claudeCodeKeychainService('/Users/test/.claude-work'), 'Claude Code-credentials-03abf0ee')
})

test('Keychain discovery lists every Claude Code item and reads each under its own account', () => {
  const keychain = new FakeKeychain()
  keychain.put('Claude Code-credentials', 'halp', blob('at-personal', 'rt-personal'))
  // A second default-named item holding only MCP data, like the one found in the wild.
  keychain.put('Claude Code-credentials', 'unknown', JSON.stringify({ mcpOAuth: {} }))
  keychain.put('Claude Code-credentials-03abf0ee', 'halp', blob('at-work', 'rt-work'))
  keychain.put('Unrelated-credentials', 'halp', blob('nope', 'nope'))

  const sources = parseKeychainDump(keychain.run(['dump-keychain'])!)
  assert.deepEqual(sources.map(source => source.kind === 'keychain' ? `${source.service}|${source.account}` : ''), [
    'Claude Code-credentials|halp',
    'Claude Code-credentials|unknown',
    'Claude Code-credentials-03abf0ee|halp',
  ])

  const found = darwinStore(keychain).discover().filter(({ source }) => source.kind === 'keychain')
  assert.deepEqual(found.map(({ session }) => session.accessToken), ['at-personal', 'at-work'])
})

test('write-back updates only the source it targets, and only from the expected token', () => {
  const keychain = new FakeKeychain()
  keychain.put('Claude Code-credentials', 'halp', blob('at-personal', 'rt-personal'))
  keychain.put('Claude Code-credentials-03abf0ee', 'halp', blob('at-work', 'rt-work'))
  const store = darwinStore(keychain)
  const work: ClaudeCodeSource = { kind: 'keychain', service: 'Claude Code-credentials-03abf0ee', account: 'halp' }
  const next = { accessToken: 'at-work-2', refreshToken: 'rt-work-2', expiresAt: Date.now() + 2 * HOUR, scopes: '' }

  assert.equal(store.writeBack(work, next, 'stale-token'), false, 'a rotation that already happened elsewhere is left alone')
  assert.equal(store.writeBack(work, next, 'at-work'), true)

  const written = JSON.parse(keychain.get('Claude Code-credentials-03abf0ee', 'halp')!)
  assert.equal(written.claudeAiOauth.refreshToken, 'rt-work-2')
  assert.deepEqual(written.mcpOAuth, { other: { accessToken: 'mcp-token' } }, 'unrelated fields survive')
  assert.equal(store.read({ kind: 'keychain', service: 'Claude Code-credentials', account: 'halp' })?.accessToken, 'at-personal')
})

test('sync imports each login once, keyed by email, and rekeys a legacy token-hash account', async () => {
  const keychain = new FakeKeychain()
  keychain.put('Claude Code-credentials', 'halp', blob('at-personal', 'rt-personal'))
  keychain.put('Claude Code-credentials-03abf0ee', 'halp', blob('at-work', 'rt-work'))
  const accounts = memoryAccounts()
  // An import from an older version: no email, keyed by token hash, refresh
  // token since rotated by the CLI.
  accounts.map.set('token-0123456789abcdef', {
    accessToken: 'at-personal', refreshToken: 'rt-old', expiresAt: Date.now() + HOUR, scopes: '', keychainBound: true,
  })
  const sync = new ClaudeCodeSync({ store: darwinStore(keychain), identify, accounts })

  const first = await sync.sync()
  assert.deepEqual([...accounts.map.keys()].sort(), ['me@example.com', 'me@work.example'])
  assert.equal(accounts.aliases.get('token-0123456789abcdef'), 'me@example.com')
  assert.deepEqual(first.imported, ['me@work.example'])
  const personal = accounts.map.get('me@example.com')!
  assert.deepEqual(personal.claudeCodeSource, { kind: 'keychain', service: 'Claude Code-credentials', account: 'halp' })
  assert.equal(accounts.map.get('me@work.example')!.claudeCodeSource?.kind, 'keychain')

  const again = await sync.sync()
  assert.deepEqual([again.imported, again.updated, again.renamed], [[], [], []], 'a second pass changes nothing')
})

test('a logged-out import stays out until a different login appears or Import is clicked', async () => {
  const keychain = new FakeKeychain()
  const service = 'Claude Code-credentials-03abf0ee'
  keychain.put(service, 'halp', blob('at-work', 'rt-work'))
  const accounts = memoryAccounts()
  const dismissals = memoryDismissals()
  const sync = new ClaudeCodeSync({ store: darwinStore(keychain), identify, accounts, dismissals })

  await sync.sync()
  await sync.dismiss(accounts.map.get('me@work.example')!)
  accounts.map.delete('me@work.example')
  await sync.sync()
  assert.equal(accounts.map.size, 0, 'the dismissed login is not re-imported')

  await sync.sync(true)
  assert.deepEqual([...accounts.map.keys()], ['me@work.example'], 'an explicit Import overrides the dismissal')

  await sync.dismiss(accounts.map.get('me@work.example')!)
  accounts.map.delete('me@work.example')
  keychain.put(service, 'halp', blob('at-other', 'rt-other'))
  await sync.sync()
  assert.deepEqual([...accounts.map.keys()], ['someone-else@example.com'], 'a new login in that store is imported')
})

test('refresh adopts the store token for the same account and detaches when the store switched accounts', async () => {
  const keychain = new FakeKeychain()
  const service = 'Claude Code-credentials-03abf0ee'
  const source: ClaudeCodeSource = { kind: 'keychain', service, account: 'halp' }
  const store = darwinStore(keychain)
  const refreshed: string[] = []
  const doRefresh = async (session: ClaudeSession): Promise<ClaudeSession> => {
    refreshed.push(session.refreshToken)
    return { ...session, accessToken: `${session.accessToken}-next`, refreshToken: `${session.refreshToken}-next`, expiresAt: Date.now() + HOUR }
  }
  const stored: ClaudeSession = {
    accessToken: 'at-personal', refreshToken: 'rt-personal', expiresAt: Date.now() - 1,
    scopes: '', emailAddress: 'me@example.com', keychainBound: true, claudeCodeSource: source,
  }

  // The CLI rotated this account's token: adopt it without a network refresh.
  keychain.put(service, 'halp', blob('at-personal-2', 'rt-personal-2'))
  const adopted = await refreshClaudeSynced(stored, doRefresh, store, identify)
  assert.equal(adopted.refreshToken, 'rt-personal-2')
  assert.deepEqual(refreshed, [])

  // Expired in both places: refresh once and write the rotation back to that store.
  keychain.put(service, 'halp', blob('at-personal', 'rt-personal', Date.now() - 1))
  const rotated = await refreshClaudeSynced(stored, doRefresh, store, identify)
  assert.equal(JSON.parse(keychain.get(service, 'halp')!).claudeAiOauth.refreshToken, rotated.refreshToken)

  // `/login` to someone else in that config dir: keep our own login, unbound.
  keychain.put(service, 'halp', blob('at-other', 'rt-other'))
  const detached = await refreshClaudeSynced(stored, doRefresh, store, identify)
  assert.equal(detached.emailAddress, 'me@example.com')
  assert.equal(detached.refreshToken, 'rt-personal-next')
  assert.equal(detached.claudeCodeSource, undefined)
  assert.equal(JSON.parse(keychain.get(service, 'halp')!).claudeAiOauth.refreshToken, 'rt-other', 'the other login is untouched')
})

test('renameAccount moves the session and keeps the old key resolving', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-rename-'))
  const path = join(dir, 'auth.json')
  try {
    const session = { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + HOUR, scopes: '', emailAddress: 'me@example.com' }
    await saveAccountSession('claude', 'token-0123456789abcdef', session, path)
    await saveAccountSession('claude', 'other@example.com', { ...session, accessToken: 'at2', refreshToken: 'rt2' }, path)

    assert.equal(await renameAccount('claude', 'token-0123456789abcdef', 'me@example.com', path), true)
    assert.deepEqual((await listAccounts('claude', path)).map(({ key }) => key), ['me@example.com', 'other@example.com'],
      'the default moves with the account')
    assert.equal(await resolveAccountKey('claude', 'token-0123456789abcdef', path), 'me@example.com')
    assert.equal((await getAccountSession('claude', 'token-0123456789abcdef', path))?.accessToken, 'at')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
