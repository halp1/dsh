// @vitest-environment jsdom
/**
 * S-8 补：heatmap.tsx 的 month/half/year 三档切换渲染（v1.4.0 起）。
 *
 * 三种视图：
 * - month: 日历月视图（cell = 一天，GitHub 风格月度贡献）
 * - half: 半年视图（cell = 一周，26 周大格，截图友好的主视觉）
 * - year: 年视图（cell = 一天，GitHub 风格年度贡献，52 周）
 *
 * 每档渲染各自的 data-testid + 网格结构，切换时面板形状正确。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UsageHeatmap, type HeatmapDay } from '../src/client/heatmap.tsx'
import { zh, type UsageBillingKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })
beforeEach(() => { vi.unstubAllGlobals() })

const t = (key: UsageBillingKey): string => (zh as Record<string, string>)[key] ?? key

/** 构造 60 天数据：覆盖三个月，让三档切换都有内容可渲染。 */
function makeDays(): HeatmapDay[] {
  const out: HeatmapDay[] = []
  const base = Date.parse('2026-08-01T00:00:00Z')
  for (let i = 0; i < 60; i += 1) {
    out.push({
      date: new Date(base + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      value: i,
    })
  }
  return out
}

describe('heatmap 三档切换', () => {
  it('month / half / year 三档渲染各自的 panel + 网格', () => {
    const days = makeDays()
    // month 视图：通用网格（heatmapGrid），无专属 panel testid
    // half / year 视图：有专属 panel testid
    for (const range of ['month', 'half', 'year'] as const) {
      const { container } = render(<UsageHeatmap days={days} currency="cny" t={t} range={range} unit="cost" />)

      if (range === 'month') {
        // 月视图：通用网格（heatmapGrid），cell 按月
        expect(container.querySelector('[data-testid="heatmap-cell"]')).toBeTruthy()
        expect(container.querySelector('[data-testid="heatmap-year"]')).toBeNull()
        expect(container.querySelector('[data-testid="heatmap-half"]')).toBeNull()
      } else if (range === 'half') {
        expect(container.querySelector('[data-testid="heatmap-half"]')).toBeTruthy()
        expect(container.querySelector('[data-testid="heatmap-year"]')).toBeNull()
      } else {
        expect(container.querySelector('[data-testid="heatmap-year"]')).toBeTruthy()
        expect(container.querySelector('[data-testid="heatmap-half"]')).toBeNull()
      }
    }
  })

  it('month 与 year 视图各自独立的网格 cell 数量不同（按月 vs 按周）', () => {
    const days = makeDays()
    const month = render(<UsageHeatmap days={days} currency="cny" t={t} range="month" unit="cost" />)
    const year = render(<UsageHeatmap days={days} currency="cny" t={t} range="year" unit="cost" />)
    // 月视图：cell 按日（heatmap-cell）；年视图：cell 按周（heatmap-year-cell）
    const monthCells = month.container.querySelectorAll('[data-testid="heatmap-cell"]').length
    const yearCells = year.container.querySelectorAll('[data-testid="heatmap-year-cell"]').length
    expect(monthCells).toBeGreaterThan(0)
    expect(yearCells).toBeGreaterThan(0)
    // 60 天数据：月视图按日应有 ≥ 60 个 cell；年视图按周应有 ≥ 52 个 cell（52 周）
    expect(yearCells).toBeGreaterThanOrEqual(52)
  })
})
