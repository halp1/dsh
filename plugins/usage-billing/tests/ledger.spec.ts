/** Durable usage-ledger file-store coverage: atomic persistence and backup recovery. */

import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageLedgerDocument, UsageLedgerSession } from '../src/aggregate.ts'
import { mergeUsageLedgerDocuments } from '../src/aggregate.ts'
import { createFileUsageLedgerStore } from '../src/index.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('createFileUsageLedgerStore', () => {
  it('atomically saves a private ledger and loads it back', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
    const path = join(root, 'nested', 'usage-ledger.json')
    const store = createFileUsageLedgerStore(path)
    const document: UsageLedgerDocument = { version: 1, updatedAt: 1, sessions: [] }

    await store.save(document)

    expect(await store.load()).toEqual(document)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(document)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('falls back to the previous complete ledger when the main file is damaged', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
    const path = join(root, 'usage-ledger.json')
    const store = createFileUsageLedgerStore(path)
    const first: UsageLedgerDocument = { version: 1, updatedAt: 1, sessions: [] }
    const second: UsageLedgerDocument = { version: 1, updatedAt: 2, sessions: [] }
    await store.save(first)
    await store.save(second)

    await writeFile(path, '{broken')

    expect(await store.load()).toEqual(first)
  })

  it('reclaims a crash-orphaned lock older than the stale threshold and saves (issue #48)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
    const path = join(root, 'usage-ledger.json')
    const store = createFileUsageLedgerStore(path)
    const document: UsageLedgerDocument = { version: 1, updatedAt: 1, sessions: [] }
    // 崩溃残留锁：mtime 拨到 2 分钟前（远超 60s 阈值），无进程会来释放。
    const stale = new Date(Date.now() - 120_000)
    await writeFile(`${path}.lock`, '999\n')
    await utimes(`${path}.lock`, stale, stale)

    await store.save(document)

    expect(await store.load()).toEqual(document)
    // 提交完成后锁文件被正常释放清理。
    await expect(stat(`${path}.lock`)).rejects.toThrow()
  })

  it('keeps failing while the contending lock is fresh (slow live writer)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
    const path = join(root, 'usage-ledger.json')
    const store = createFileUsageLedgerStore(path)
    // 新鲜锁：可能是慢 writer 的活跃锁，不做年龄自愈，等待超时后原样失败。
    await writeFile(`${path}.lock`, '999\n')

    await expect(store.save({ version: 1, updatedAt: 1, sessions: [] }))
      .rejects.toThrow('timed out waiting for the writer lock')
    // 锁未被误删：持有者（若有）的锁权属不变。
    await expect(stat(`${path}.lock`)).resolves.toBeTruthy()
  }, 10_000)
})

/** 合并测试用的最小行（merge 不校验 fold 内容，任意 JSON-safe 形状即可）。 */
function row(id: string, foldedAt: number | undefined, foldVersion = 1): UsageLedgerSession {
  return { id, foldVersion, ...(foldedAt === undefined ? {} : { foldedAt }), fold: {} as UsageLedgerSession['fold'] }
}

describe('mergeUsageLedgerDocuments (multi-instance last-writer-wins fix)', () => {
  const doc = (sessions: UsageLedgerSession[], applied?: string[]): UsageLedgerDocument =>
    ({ version: 1, updatedAt: 1, sessions, ...(applied === undefined ? {} : { appliedMigrations: applied }) })

  it('keeps rows only the other instance wrote (no lost writes)', () => {
    const merged = mergeUsageLedgerDocuments(doc([row('a', 100)]), doc([row('b', 200)]))
    expect(merged.sessions.map(s => s.id).sort()).toEqual(['a', 'b'])
  })

  it('resolves the same-session conflict by foldedAt: either side may win', () => {
    // 磁盘行更新（他实例后折）→ 磁盘行胜。
    const keepDisk = mergeUsageLedgerDocuments(doc([row('a', 100)]), doc([row('a', 200)]))
    expect(keepDisk.sessions[0]?.foldedAt).toBe(200)
    // 本进程行更新（本实例后折）→ 本进程行胜。
    const keepMine = mergeUsageLedgerDocuments(doc([row('a', 300)]), doc([row('a', 200)]))
    expect(keepMine.sessions[0]?.foldedAt).toBe(300)
  })

  it('breaks foldedAt ties by foldVersion, then prefers the incoming row', () => {
    const byVersion = mergeUsageLedgerDocuments(doc([row('a', 100, 1)]), doc([row('a', 100, 2)]))
    expect(byVersion.sessions[0]?.foldVersion).toBe(2)
    const fullTie = mergeUsageLedgerDocuments(doc([row('a', 100, 1)]), doc([row('a', 100, 1)]))
    expect(fullTie.sessions).toHaveLength(1)
  })

  it('treats pre-merge rows without foldedAt as the oldest', () => {
    const merged = mergeUsageLedgerDocuments(doc([row('a', 1)]), doc([row('a', undefined)]))
    expect(merged.sessions[0]?.foldedAt).toBe(1)
  })

  it('unions appliedMigrations so no instance re-runs the other\u2019s migrations', () => {
    const merged = mergeUsageLedgerDocuments(doc([], ['m1']), doc([], ['m2', 'm1']))
    expect([...(merged.appliedMigrations ?? [])].sort()).toEqual(['m1', 'm2'])
    expect(mergeUsageLedgerDocuments(doc([]), doc([])).appliedMigrations).toBeUndefined()
  })
})

describe('createFileUsageLedgerStore multi-instance merge', () => {
  it('merges on save: a second instance saving cannot erase the first instance\u2019s rows', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
    const path = join(root, 'usage-ledger.json')
    // 两个实例 = 同一路径上的两个 store 句柄（进程间只有文件系统共享）。
    const instanceA = createFileUsageLedgerStore(path)
    const instanceB = createFileUsageLedgerStore(path)
    // A 折了会话 a 并落盘。
    await instanceA.save({ version: 1, updatedAt: 1, sessions: [row('a', 100)] })
    // B 的内存账本没有 a（尚未重载），只写自己的 b：磁盘上 a 必须幸存。
    await instanceB.save({ version: 1, updatedAt: 2, sessions: [row('b', 200)] })
    const afterB = await instanceA.load()
    expect(afterB?.sessions.map(s => s.id).sort()).toEqual(['a', 'b'])
    // A 后折了 a（foldedAt 更新）：同 id 冲突按新者胜，b 仍幸存。
    await instanceA.save({ version: 1, updatedAt: 3, sessions: [row('a', 300), row('c', 300)] })
    const afterA = await instanceB.load()
    expect(afterA?.sessions.map(s => s.id).sort()).toEqual(['a', 'b', 'c'])
    expect(afterA?.sessions.find(s => s.id === 'a')?.foldedAt).toBe(300)
  })

  it('does not merge a non-ledger-shaped file (no merge base, straight overwrite)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
    const path = join(root, 'usage-ledger.json')
    const store = createFileUsageLedgerStore(path)
    await writeFile(path, JSON.stringify({ version: 9, sessions: 'not-a-ledger' }))
    await store.save({ version: 1, updatedAt: 1, sessions: [row('a', 1)] })
    expect((await store.load())?.sessions.map(s => s.id)).toEqual(['a'])
  })
})
