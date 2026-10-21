/**
 * 会话明细展示归组的树形委派（issue #99 方案 A 最小版）：
 * 多级子智能体不再拍平到根对话——一阶挂顶层组，二阶起嵌套在直接委派方的子行
 * 之下，组内按链合计（本行 + 全部下级）倒序，「哪一次委派最贵」一眼可读。
 * 口径红线：纯展示层归组，任何总额桶不经此处（费用列恒为本行口径，链合计
 * 只出现在徽标）。环防护：异常数据互指父子不得造出渲染死循环。
 */

import { describe, expect, it } from 'vitest'
import { buildSessionDisplay } from '../src/client/domain/provider-merge.ts'
import type { SessionBillingRow } from '../src/client/domain/types.ts'

/** 一行会话：只带测试关心的字段（费用/调用/时间）。 */
function row(id: string, cost: number, opts: { parentId?: string; title?: string; subCost?: number; subCalls?: number; lastActive?: number } = {}): SessionBillingRow {
  return {
    id,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}),
    ...(opts.subCost !== undefined ? { subCost: opts.subCost } : {}),
    ...(opts.subCalls !== undefined ? { subCalls: opts.subCalls } : {}),
    calls: 1,
    cost,
    lastActive: opts.lastActive ?? 1000,
  }
}

describe('buildSessionDisplay 树形委派（issue #99）', () => {
  it('nests level-2 subs under their direct level-1 parent instead of flattening', () => {
    // 场景同 issue：根对话委派 2 个一阶，其中一个又委派了 1 个二阶。
    const root = row('root', 5)
    const l1a = row('l1a', 3, { parentId: 'root' })
    const l1b = row('l1b', 1, { parentId: 'root' })
    const l2 = row('l2', 2, { parentId: 'l1a' })
    const [display] = buildSessionDisplay([root, l1a, l1b, l2])
    expect(display?.id).toBe('root')
    // 一阶两行挂在根下；二阶嵌套在其直接委派方 l1a 之下，不再平铺到根。
    expect(display?.subs?.map(sub => sub.id)).toEqual(['l1a', 'l1b'])
    expect(display?.subs?.[0]?.subs?.map(sub => sub.id)).toEqual(['l2'])
    expect(display?.subs?.[1]?.subs).toBeUndefined()
  })

  it('sorts first-level subs by chain cost (own + descendants) descending', () => {
    const root = row('root', 1)
    // l1cheap 本行便宜但链合计更高（3+2=5 > 4），应排在前面。
    const l1cheap = row('l1cheap', 3, { parentId: 'root', subCost: 2, subCalls: 1 })
    const l1dear = row('l1dear', 4, { parentId: 'root' })
    const [display] = buildSessionDisplay([root, l1cheap, l1dear])
    expect(display?.subs?.map(sub => sub.id)).toEqual(['l1cheap', 'l1dear'])
  })

  it('keeps totals display-only: rows keep their own cost, chain total only via subCost badge data', () => {
    // 口径红线：归组不改任何行的费用（总额桶在聚合层，此处只拆开展示）。
    const root = row('root', 5, { subCost: 5, subCalls: 3 })
    const l1 = row('l1', 3, { parentId: 'root', subCost: 2, subCalls: 1 })
    const l2 = row('l2', 2, { parentId: 'l1' })
    const [display] = buildSessionDisplay([root, l1, l2])
    expect(display?.cost).toBe(5)
    expect(display?.subCost).toBe(5)
    expect(display?.subs?.[0]?.cost).toBe(3)
    expect(display?.subs?.[0]?.subs?.[0]?.cost).toBe(2)
  })

  it('falls back to the root group when the direct parent sub is absent from the batch', () => {
    // 服务端封顶 / 日志已删：二阶的直接父（一阶）不在切片内 → 沿父链挂到根组。
    const root = row('root', 5)
    const l2 = row('l2', 2, { parentId: 'missing-l1' })
    const display = buildSessionDisplay([root, l2])
    // missing-l1 不在索引里且无父链可走 → l2 落不到根组（父 id 不指向任何存活行），
    // 作为独立子行并回顶层，不丢数据。
    expect(display.map(entry => entry.id)).toContain('l2')
  })

  it('does not loop on mutually-referencing parent ids (anomalous data)', () => {
    // 异常数据互指父子：树挂靠的环防护必须兜底，渲染层才不会死循环。
    const a = row('a', 1, { parentId: 'b' })
    const b = row('b', 2, { parentId: 'a' })
    const display = buildSessionDisplay([a, b])
    // 全部行都在（或为顶层独立行，或挂在树上），且树无环（父链走一圈必回顶层/独立行）。
    const ids = new Set<string>()
    const walk = (rows: readonly SessionBillingRow[]): void => {
      for (const entry of rows) {
        expect(ids.has(entry.id)).toBe(false)
        ids.add(entry.id)
        walk(entry.subs ?? [])
      }
    }
    walk(display)
    expect(ids.size).toBe(2)
  })

  it('attaches a sub whose parent id points at any segment of a merged title group', () => {
    // issue #42 合并组：父会话 id 是组内任一段时都挂到组行（回归既有行为）。
    const seg1 = row('seg1', 2, { title: '同一任务' })
    const seg2 = row('seg2', 3, { title: '同一任务' })
    const sub = row('sub', 1, { parentId: 'seg2' })
    const display = buildSessionDisplay([seg1, seg2, sub])
    expect(display).toHaveLength(1)
    expect(display[0]?.subs?.map(entry => entry.id)).toEqual(['sub'])
  })

  it('keeps same-titled subagent rows out of title merging (they attach by parent chain)', () => {
    // 子会话与顶层会话撞标题时会错并——归组的过滤在前（buildSessionDisplay 只把
    // 顶层行喂给 mergeSessionRows），子行按父链归位（回归既有行为）。
    const top = row('top', 5, { title: '任务' })
    const sub = row('sub', 1, { parentId: 'top', title: '任务' })
    const display = buildSessionDisplay([top, sub])
    expect(display).toHaveLength(1)
    expect(display[0]?.mergedCount).toBe(1)
    expect(display[0]?.subs?.map(entry => entry.id)).toEqual(['sub'])
  })

  it('sorts the subs of an orphan subtree root by chain cost, same as under a top-level group (issue #102)', () => {
    // 孤儿子树：x 的父不在本批（封顶/日志删），x 自己成了子树根并带下级 y/z。
    // 此前 sortSubs 只跑 tops，x.subs 保持插入序 [y, z]——「谁最贵」的读法取决于
    // 父会话那条日志还在不在，正是孤儿场景最不该出现的不一致。
    const x = row('x', 2, { parentId: 'MISSING', subCost: 4, subCalls: 2 })
    const y = row('y', 1, { parentId: 'x' })
    const z = row('z', 3, { parentId: 'x' })
    const orphanDisplay = buildSessionDisplay([x, y, z])
    const orphanRoot = orphanDisplay.find(entry => entry.id === 'x')
    expect(orphanRoot?.subs?.map(sub => sub.id)).toEqual(['z', 'y'])
    // 对照：同样的数据，x 的父换成批内顶层 → 读法必须一致。
    const top = row('top', 10)
    const xUnderTop = row('x', 2, { parentId: 'top', subCost: 4, subCalls: 2 })
    const [groupDisplay] = buildSessionDisplay([top, xUnderTop, y, z])
    expect(groupDisplay?.subs?.[0]?.subs?.map(sub => sub.id)).toEqual(['z', 'y'])
  })

  it('orders top-level rows by own cost, not chain total (explicit contract; subs use chain total)', () => {
    // 两级两把尺（#102 讨论后显式约定）：顶层按本行费用——与费用列读数单调一致、
    // 顶层本行相加即总额不重复计；子级按链合计——回答「哪次委派最贵（含下级）」。
    // A 自身 5 + 下级 100（链 105），B 自身 50 无委派：顶层顺序 B、A。
    const a = row('A', 5, { subCost: 100, subCalls: 1 })
    const aSub = row('A-sub', 100, { parentId: 'A' })
    const b = row('B', 50)
    const display = buildSessionDisplay([a, aSub, b])
    expect(display.map(entry => entry.id)).toEqual(['B', 'A'])
    expect(display[1]?.subs?.map(sub => sub.id)).toEqual(['A-sub'])
  })
})
