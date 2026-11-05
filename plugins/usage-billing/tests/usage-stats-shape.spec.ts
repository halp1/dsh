/**
 * S-7：usage-stats 响应边界的 wire 形状校验（schemastery 金丝雀）。
 *
 * `usageStatsShapeError` 是只读校验：返回漂移原因（null = 正常），绝不改动
 * 下发文档。本 spec 覆盖：合法文档零告警、若干漂移形态各自被抓到、快照缺
 * 字段形态（可选字段缺失）不产生假阳性。
 */

import { describe, expect, it } from 'vitest'
import { usageStatsShapeError } from '../src/routes/usage-stats.ts'

/** 最小合法聚合文档：与 aggregateOnce 输出同构（核心字段）。 */
function validDoc(): Record<string, unknown> {
  return {
    version: 4,
    updatedAt: Date.now(),
    source: 'session-logs',
    total: { calls: 2, input: 300, output: 100, cacheHit: 200, cacheMiss: 100, cost: 0.5, reasoning: 10 },
    byModel: {
      flash: { calls: 2, input: 300, output: 100, cacheHit: 200, cacheMiss: 100, cost: 0.5, reasoning: 10 },
    },
    byDay: {
      '2026-10-18': { calls: 2, input: 300, output: 100, cacheHit: 200, cacheMiss: 100, cost: 0.5, reasoning: 10 },
    },
    byDayModels: {
      '2026-10-18': {
        flash: { calls: 2, input: 300, output: 100, cacheHit: 200, cacheMiss: 100, cost: 0.5 },
      },
    },
    bySession: [
      { id: 's1', calls: 2, cost: 0.5, lastActive: Date.now() },
    ],
  }
}

describe('usageStatsShapeError（S-7 wire 金丝雀）', () => {
  it('合法聚合文档返回 null（零误报）', () => {
    expect(usageStatsShapeError(validDoc())).toBeNull()
  })

  it('total.cost 类型漂移（number → string）被抓到', () => {
    const doc = validDoc()
    ;(doc.total as { cost: unknown }).cost = '0.5'
    expect(usageStatsShapeError(doc)).not.toBeNull()
  })

  it('byModel 缺失被抓到', () => {
    const doc = validDoc()
    delete doc.byModel
    expect(usageStatsShapeError(doc)).not.toBeNull()
  })

  it('bySession 行缺 id 被抓到', () => {
    const doc = validDoc()
    ;(doc.bySession as { id?: string }[])[0]!.id = undefined
    expect(usageStatsShapeError(doc)).not.toBeNull()
  })

  it('非对象输入（null / 数组 / 标量）被抓到', () => {
    expect(usageStatsShapeError(null)).not.toBeNull()
    expect(usageStatsShapeError([])).not.toBeNull()
    expect(usageStatsShapeError('doc')).not.toBeNull()
  })

  it('可选维度缺失不产生假阳性（byTier / bySite / perf 等不在 schema 内）', () => {
    const doc = validDoc()
    // 这些字段 aggregateOnce 只在有数据时下发；schema 刻意不校验它们
    doc.byTier = undefined
    doc.bySite = undefined
    doc.perf = undefined
    doc.unpricedModels = undefined
    expect(usageStatsShapeError(doc)).toBeNull()
  })
})
