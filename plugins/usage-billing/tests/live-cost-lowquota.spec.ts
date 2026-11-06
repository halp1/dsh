// @vitest-environment jsdom
/**
 * S-8 补：live-cost.tsx 的 lowQuotaChips（audit 原写 lowQuotaTooltipKey 是笔误）。
 *
 * 订阅额度预警 chips：状态过滤（ok）+ 剩余百分比过滤（≤20%）+ 排序（升序）+
 * 封顶 3 枚。本 spec 覆盖全部行为维度。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lowQuotaChips } from '../src/client/live-cost.tsx'

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lowQuotaChips', () => {
  it('只保留 status=ok 且剩余 ≤20% 的窗口，按剩余升序，封顶 3 枚', () => {
    const quotas = [
      {
        provider: 'ok-high',
        displayName: 'OK High',
        status: 'ok' as const,
        windows: [{ kind: 'weekly' as const, usedPercent: 80, remainingPercent: 20 }],
      },
      {
        provider: 'ok-low',
        displayName: 'OK Low',
        status: 'ok' as const,
        windows: [
          { kind: 'weekly' as const, usedPercent: 90, remainingPercent: 10 },
          { kind: 'monthly' as const, usedPercent: 95, remainingPercent: 5 },
        ],
      },
      {
        provider: 'not-ok',
        displayName: 'Not OK',
        status: 'unauthorized' as const,
        windows: [{ kind: 'weekly' as const, usedPercent: 99, remainingPercent: 1 }],
      },
      {
        provider: 'ok-safe',
        displayName: 'OK Safe',
        status: 'ok' as const,
        windows: [{ kind: 'weekly' as const, usedPercent: 50, remainingPercent: 50 }],
      },
    ]

    const chips = lowQuotaChips(quotas)

    // 按剩余升序：5% < 10% < 20% < 50%（50% 被 20% 阈值过滤掉，20% 恰好命中阈值）
    expect(chips).toHaveLength(3)
    expect(chips[0]).toMatchObject({ name: 'OK Low', kind: 'monthly', pct: 5 })
    expect(chips[1]).toMatchObject({ name: 'OK Low', kind: 'weekly', pct: 10 })
    expect(chips[2]).toMatchObject({ name: 'OK High', kind: 'weekly', pct: 20 })
    // not-ok 与 ok-safe 被过滤
    expect(chips.some(c => c.name === 'Not OK')).toBe(false)
    expect(chips.some(c => c.name === 'OK Safe')).toBe(false)
  })

  it('无符合条件的窗口时返回空数组', () => {
    expect(lowQuotaChips([])).toEqual([])
    expect(lowQuotaChips([
      {
        provider: 'ok',
        displayName: 'OK',
        status: 'ok' as const,
        windows: [{ kind: 'weekly' as const, usedPercent: 50, remainingPercent: 50 }],
      },
    ])).toEqual([])
  })

  it('封顶 3 枚：4 个低剩余窗口只保留前 3 枚', () => {
    const quotas = [
      {
        provider: 'a',
        displayName: 'A',
        status: 'ok' as const,
        windows: [
          { kind: 'weekly' as const, usedPercent: 95, remainingPercent: 5 },
          { kind: 'monthly' as const, usedPercent: 90, remainingPercent: 10 },
          { kind: 'billing' as const, usedPercent: 85, remainingPercent: 15 },
          { kind: 'session' as const, usedPercent: 80, remainingPercent: 20 },
        ],
      },
    ]
    expect(lowQuotaChips(quotas)).toHaveLength(3)
  })
})
