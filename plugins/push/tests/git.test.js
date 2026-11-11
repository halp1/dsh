/**
 * The git half against real repositories: a bare "remote", a clone that
 * commits, and a second clone that pushes behind its back. These cover the
 * enabling rule (what counts as pushable) and the pull-then-push run,
 * including the failure paths that must leave the workspace untouched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pullAndPush, pushStatus } from '../src/git.ts'
import { createRunGate, parseRunBody, statusAll } from '../src/index.ts'

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim()
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_NOSYSTEM = '1'
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })

function commit(cwd, file, text) {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `edit ${file}`)
}

/** A bare remote with one commit on main and two independent clones of it. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dshpush-'))
  const remote = join(dir, 'remote.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  const seed = join(dir, 'seed')
  git(dir, 'init', '-q', '-b', 'main', seed)
  commit(seed, 'a.txt', 'a\n')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '-q', '-u', 'origin', 'main')
  const clone = (name) => {
    const path = join(dir, name)
    git(dir, 'clone', '-q', remote, path)
    return path
  }
  return { dir, remote, mine: clone('mine'), theirs: clone('theirs') }
}

test('pushStatus: the button is enabled only for commits the remote lacks', async () => {
  const { dir, mine } = fixture()
  assert.deepEqual(await pushStatus(mine), { kind: 'idle', reason: 'clean' })

  commit(mine, 'b.txt', 'b\n')
  commit(mine, 'c.txt', 'c\n')
  assert.deepEqual(await pushStatus(mine), { kind: 'ahead', ahead: 2, branch: 'main' })

  // A new branch with no upstream is still pushable, counting only its own commits.
  git(mine, 'push', '-q')
  git(mine, 'switch', '-q', '-c', 'feature')
  assert.deepEqual(await pushStatus(mine), { kind: 'idle', reason: 'clean' })
  commit(mine, 'd.txt', 'd\n')
  assert.deepEqual(await pushStatus(mine), { kind: 'ahead', ahead: 1, branch: 'feature' })

  git(mine, 'checkout', '-q', '--detach')
  assert.deepEqual(await pushStatus(mine), { kind: 'idle', reason: 'detached' })

  const plain = join(dir, 'plain')
  git(dir, 'init', '-q', '-b', 'main', plain)
  commit(plain, 'x.txt', 'x\n')
  assert.deepEqual(await pushStatus(plain), { kind: 'idle', reason: 'no-remote' })
  assert.deepEqual(await pushStatus(dir), { kind: 'idle', reason: 'no-repo' })
})

test('pullAndPush: pulls a diverged remote, keeps local edits, then pushes', async () => {
  const { remote, mine, theirs } = fixture()
  commit(theirs, 'theirs.txt', 'theirs\n')
  git(theirs, 'push', '-q')
  commit(mine, 'mine.txt', 'mine\n')
  writeFileSync(join(mine, 'a.txt'), 'uncommitted\n')

  assert.deepEqual(await pullAndPush(mine), { ok: true, pulled: true })
  assert.equal(readFileSync(join(mine, 'a.txt'), 'utf8'), 'uncommitted\n', 'autostash restores the edit')
  assert.ok(existsSync(join(mine, 'theirs.txt')))
  assert.equal(git(remote, 'rev-parse', 'main'), git(mine, 'rev-parse', 'HEAD'))
  assert.deepEqual(await pushStatus(mine), { kind: 'idle', reason: 'clean' })
})

test('pullAndPush: a conflicting pull is aborted and nothing is pushed', async () => {
  const { remote, mine, theirs } = fixture()
  commit(theirs, 'a.txt', 'theirs\n')
  git(theirs, 'push', '-q')
  commit(mine, 'a.txt', 'mine\n')
  const before = git(mine, 'rev-parse', 'HEAD')
  const remoteBefore = git(remote, 'rev-parse', 'main')

  const result = await pullAndPush(mine)
  assert.equal(result.ok, false)
  assert.equal(result.step, 'pull')
  assert.match(result.message, /conflict/i)
  assert.equal(git(mine, 'rev-parse', 'HEAD'), before)
  assert.equal(git(mine, 'status', '--porcelain'), '', 'no half-finished merge left behind')
  assert.equal(git(remote, 'rev-parse', 'main'), remoteBefore)
})

test('pullAndPush: publishes a branch without an upstream and reports push failures', async () => {
  const { remote, mine } = fixture()
  git(mine, 'switch', '-q', '-c', 'feature')
  commit(mine, 'f.txt', 'f\n')
  assert.deepEqual(await pullAndPush(mine), { ok: true, pulled: false })
  assert.equal(git(remote, 'rev-parse', 'feature'), git(mine, 'rev-parse', 'HEAD'))
  assert.equal(git(mine, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/feature')

  // A remote hook that rejects every push.
  writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho "rejected by policy" >&2\nexit 1\n', { mode: 0o755 })
  commit(mine, 'g.txt', 'g\n')
  const result = await pullAndPush(mine)
  assert.equal(result.ok, false)
  assert.equal(result.step, 'push')
  assert.match(result.message, /rejected by policy/)
})

test('statusAll, run gate and body validation', async () => {
  const { mine, theirs } = fixture()
  commit(mine, 'b.txt', 'b\n')
  const registry = { list: () => [{ id: 'w1', path: mine }, { id: 'w2', path: theirs }] }
  const gate = createRunGate()

  let release
  const first = gate.run('w1', () => new Promise(resolve => { release = resolve }))
  assert.equal(await gate.run('w1', async () => 'second'), undefined, 'a second run in the same workspace is refused')
  assert.deepEqual(await statusAll(registry, gate.isRunning), [
    { workspaceId: 'w1', running: true, kind: 'ahead', ahead: 1, branch: 'main' },
    { workspaceId: 'w2', running: false, kind: 'idle', reason: 'clean' },
  ])
  release('done')
  assert.equal(await first, 'done')
  assert.equal(gate.isRunning('w1'), false)

  assert.deepEqual(parseRunBody('{"workspaceId":"w1"}'), { workspaceId: 'w1' })
  for (const bad of ['nope', 'null', '{}', '{"workspaceId":""}', '{"workspaceId":3}']) {
    assert.equal(typeof parseRunBody(bad), 'string', bad)
  }
})
