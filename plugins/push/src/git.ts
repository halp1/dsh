/**
 * Git operations behind the push button: how many commits a workspace has
 * to push, and the pull-then-push run itself.
 *
 * Every command runs non-interactively (`GIT_TERMINAL_PROMPT=0`) under a
 * timeout, so a credential prompt fails fast instead of hanging the route.
 * @module
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/** What one workspace can push right now. */
export type PushStatus =
  /** Commits on HEAD that the remote does not have yet. */
  | { readonly kind: 'ahead', readonly ahead: number, readonly branch: string }
  /** Up to date, or nothing that can be pushed (detached HEAD, no remote, not a repo). */
  | { readonly kind: 'idle', readonly reason: 'clean' | 'no-repo' | 'no-remote' | 'detached' }
  /** Git itself failed while answering. */
  | { readonly kind: 'error', readonly message: string }

/** Outcome of one pull-then-push run. */
export type PushResult =
  | { readonly ok: true, readonly pulled: boolean }
  | { readonly ok: false, readonly step: 'pull' | 'push', readonly message: string }

/** Raw outcome of one git invocation. */
export interface GitOutput {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs one git command in a directory. Injectable for tests. */
export type GitRunner = (cwd: string, args: readonly string[], timeoutMs: number) => Promise<GitOutput>

const STATUS_TIMEOUT_MS = 10_000
const NETWORK_TIMEOUT_MS = 120_000

/**
 * Spawn git without a shell and never throw: spawn errors and timeouts come
 * back as a non-zero code with the reason in stderr.
 */
export const runGit: GitRunner = (cwd, args, timeoutMs) => new Promise((resolve) => {
  execFile('git', [...args], {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', LC_ALL: 'C' },
  }, (error, stdout, stderr) => {
    if (error === null) {
      resolve({ code: 0, stdout, stderr })
      return
    }
    const code = typeof error.code === 'number' ? error.code : 1
    const reason = error.killed ? `git ${args[0] ?? ''} timed out after ${Math.round(timeoutMs / 1000)}s` : ''
    resolve({ code: code === 0 ? 1 : code, stdout, stderr: [stderr, reason || (stderr === '' ? error.message : '')].filter(Boolean).join('\n') })
  })
})

/**
 * The readable part of a failed command. Git splits a failure across both
 * streams (a pull prints CONFLICT lines on stdout and fetch progress on
 * stderr), so both are kept, minus the fetch progress lines.
 */
export function failureText(output: GitOutput): string {
  const lines = `${output.stdout}\n${output.stderr}`.split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '' && !/^From |^ {3}\S+\.\.\S+ |^ \* /.test(line))
  return lines.length === 0 ? `git exited with code ${output.code}` : lines.join('\n')
}

/**
 * Count the commits a workspace would push.
 *
 * With an upstream, that is `@{upstream}..HEAD`. A branch without one is
 * still pushable when a remote exists: its commits that no remote-tracking
 * ref contains are what `git push -u` would publish.
 * @param cwd - workspace directory.
 * @param git - command runner.
 * @returns the workspace's push status.
 */
export async function pushStatus(cwd: string, git: GitRunner = runGit): Promise<PushStatus> {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'], STATUS_TIMEOUT_MS)
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return { kind: 'idle', reason: 'no-repo' }

  const branchRef = await git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'], STATUS_TIMEOUT_MS)
  if (branchRef.code !== 0) return { kind: 'idle', reason: 'detached' }
  const branch = branchRef.stdout.trim()

  const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], STATUS_TIMEOUT_MS)
  let count: GitOutput
  if (upstream.code === 0) {
    count = await git(cwd, ['rev-list', '--count', '@{upstream}..HEAD'], STATUS_TIMEOUT_MS)
  } else {
    if ((await defaultRemote(cwd, git)) === undefined) return { kind: 'idle', reason: 'no-remote' }
    // An unborn branch has no HEAD commit yet, so nothing to push.
    const head = await git(cwd, ['rev-parse', '-q', '--verify', 'HEAD'], STATUS_TIMEOUT_MS)
    if (head.code !== 0) return { kind: 'idle', reason: 'clean' }
    count = await git(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'], STATUS_TIMEOUT_MS)
  }
  if (count.code !== 0) return { kind: 'error', message: failureText(count) }
  const ahead = Number.parseInt(count.stdout.trim(), 10)
  if (!Number.isSafeInteger(ahead)) return { kind: 'error', message: `unexpected rev-list output: ${count.stdout.trim()}` }
  return ahead > 0 ? { kind: 'ahead', ahead, branch } : { kind: 'idle', reason: 'clean' }
}

/** `origin` when it exists, else the first configured remote. */
async function defaultRemote(cwd: string, git: GitRunner): Promise<string | undefined> {
  const remotes = await git(cwd, ['remote'], STATUS_TIMEOUT_MS)
  if (remotes.code !== 0) return undefined
  const names = remotes.stdout.split('\n').map(name => name.trim()).filter(Boolean)
  return names.includes('origin') ? 'origin' : names[0]
}

/**
 * The pull strategy flags. Git refuses to reconcile divergent branches when
 * the user configured no strategy at all, so that case falls back to git's
 * historical merge. A configured `pull.rebase` or `pull.ff` always wins.
 */
async function pullStrategyArgs(cwd: string, git: GitRunner): Promise<string[]> {
  const branch = await git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'], STATUS_TIMEOUT_MS)
  const keys = ['pull.rebase', 'pull.ff']
  if (branch.code === 0) keys.unshift(`branch.${branch.stdout.trim()}.rebase`)
  for (const key of keys) {
    const value = await git(cwd, ['config', '--get', key], STATUS_TIMEOUT_MS)
    if (value.code === 0 && value.stdout.trim() !== '') return []
  }
  return ['--no-rebase']
}

/**
 * Leave the repository as it was before a failed pull: abort a merge or
 * rebase the pull stopped in the middle of.
 */
async function abortInterruptedPull(cwd: string, git: GitRunner): Promise<boolean> {
  const merging = await git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], STATUS_TIMEOUT_MS)
  if (merging.code === 0) {
    await git(cwd, ['merge', '--abort'], STATUS_TIMEOUT_MS)
    return true
  }
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    const path = await git(cwd, ['rev-parse', '--git-path', dir], STATUS_TIMEOUT_MS)
    if (path.code !== 0) continue
    const resolved = path.stdout.trim()
    if (existsSync(isAbsolute(resolved) ? resolved : join(cwd, resolved))) {
      await git(cwd, ['rebase', '--abort'], STATUS_TIMEOUT_MS)
      return true
    }
  }
  return false
}

/**
 * Pull, then push.
 *
 * The pull uses the user's own pull strategy (merge or rebase from git
 * config) with `--autostash`, so uncommitted edits in the workspace do not
 * block it. A pull that stops on conflicts is aborted so the workspace is
 * not left mid-merge. A branch without an upstream skips the pull and
 * publishes with `git push -u <remote> HEAD`.
 * @param cwd - workspace directory.
 * @param git - command runner.
 * @returns what happened.
 */
export async function pullAndPush(cwd: string, git: GitRunner = runGit): Promise<PushResult> {
  const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], STATUS_TIMEOUT_MS)
  if (upstream.code !== 0) {
    const remote = await defaultRemote(cwd, git)
    if (remote === undefined) return { ok: false, step: 'push', message: 'This repository has no remote to push to.' }
    const push = await git(cwd, ['push', '-u', remote, 'HEAD'], NETWORK_TIMEOUT_MS)
    return push.code === 0 ? { ok: true, pulled: false } : { ok: false, step: 'push', message: failureText(push) }
  }

  const pull = await git(cwd, ['pull', ...(await pullStrategyArgs(cwd, git)), '--no-edit', '--autostash'], NETWORK_TIMEOUT_MS)
  if (pull.code !== 0) {
    const aborted = await abortInterruptedPull(cwd, git)
    const message = failureText(pull)
    return { ok: false, step: 'pull', message: aborted ? `${message}\n\nThe pull was aborted, so the workspace is unchanged.` : message }
  }
  const push = await git(cwd, ['push'], NETWORK_TIMEOUT_MS)
  return push.code === 0 ? { ok: true, pulled: true } : { ok: false, step: 'push', message: failureText(push) }
}
