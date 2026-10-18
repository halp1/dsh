// @vitest-environment jsdom
/**
 * 视觉批 a11y 回归（V-2 / V-3）。
 *
 * V-2：KPI 七卡定义 tooltip 的词典条目全部非空（zh/en；键集齐平由既有
 * locale parity 测试守护，此处防「键存在但值为空串」回归）。
 * V-3：厂商健康点三态不再仅靠颜色——role="img" + aria-label + title 携带
 * 状态文本（在线/失效/未知），读屏与悬停均可得。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { applyBuiltinCatalog } from '../src/client/pricing.ts'
import { BUILTIN_MODEL_CATALOG, BUILTIN_MODEL_KEY_ALIASES } from '../src/builtin-catalog.ts'
import { UsageBilling } from '../src/client/UsageBilling.tsx'
import { notifiedKeys } from '../src/client/domain/notify.ts'
import { createBillingBudgetStore } from '../src/client/budget-store.ts'
import { bindSnapshotSelector } from './bind-snapshot-selector'
import { zh, en } from '../src/client/locales.ts'

// 测试套件承担宿主注入角色：目录与别名表在模块加载时全量注入——
// 否则 modelOf('flash') 落「其他」兜底条目，厂商健康点匹配不到 DeepSeek。
applyBuiltinCatalog(BUILTIN_MODEL_CATALOG, BUILTIN_MODEL_KEY_ALIASES)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  localStorage.clear()
  notifiedKeys.clear()
})

describe('V-2：KPI 定义词典非空', () => {
  const KEYS = [
    'kpiDescCacheHit',
    'kpiDescTokens',
    'kpiDescAvgCost',
    'kpiDescCalls',
    'kpiDescReasoning',
    'kpiDescIo',
    'kpiDescPeak',
  ] as const

  it('zh 与 en 词典全部非空字符串', () => {
    for (const key of KEYS) {
      expect((zh as Record<string, string>)[key]?.length ?? 0,
        `zh.${key} 为空`).toBeGreaterThan(0)
      expect((en as Record<string, string>)[key]?.length ?? 0,
        `en.${key} 为空`).toBeGreaterThan(0)
    }
  })
})

describe('V-3：厂商健康点状态可访问', () => {
  function makeProps(health: { checked: boolean; available: boolean; models: number; failures: number; okProviders: string[]; badProviders: string[] }): ComponentProps<typeof UsageBilling> {
    const budgetStore = createBillingBudgetStore().create()
    return {
      wide: true,
      t: (key: string): string => (zh as Record<string, string>)[key] ?? key,
      checkModels: async () => health,
      publishCosts: () => {},
      registerOpen: () => () => {},
      renderSlot: () => null,
      useStore: bindSnapshotSelector(budgetStore),
      actions: budgetStore.actions,
    } as unknown as ComponentProps<typeof UsageBilling>
  }

  function stubFetch(seedSite?: Record<string, unknown>): void {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/billing/usage-stats')) {
        return new Response(JSON.stringify({
          total: { calls: 1, input: 100, output: 50, cacheHit: 50, cacheMiss: 50, cost: 0.1, reasoning: 0 },
          byModel: { flash: { calls: 1, input: 100, output: 50, cacheHit: 50, cacheMiss: 50, cost: 0.1, reasoning: 0 } },
          byDay: {},
          byDayModels: {},
          // 厂商组数据源（通道聚合）：有格子才有组头，健康点才存在
          byDayModelsSite: seedSite ?? {},
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch)
  }

  it('探活在线时：厂商组健康点带「厂商在线」aria-label 与 title', async () => {
    stubFetch({
      '2026-10-18': {
        flash: { 'direct:deepseek': { calls: 1, input: 100, output: 50, cacheHit: 50, cacheMiss: 50, cost: 0.1 } },
      },
    })
    const rendered = render(<UsageBilling {...makeProps({
      checked: true, available: true, models: 3, failures: 0, okProviders: ['DeepSeek'], badProviders: [],
    })} />)
    fireEvent.click(rendered.getByTestId('billing-trigger'))
    await waitFor(() => { expect(rendered.getByTestId('billing-dashboard')).toBeTruthy() })
    fireEvent.click(rendered.getByTestId('billing-tab-providers'))
    await waitFor(() => { expect(rendered.getByTestId('billing-panel-providers')).toBeTruthy() })
    // 等探活结果落到厂商组健康点（宿主 Modal 是 portal，查询走 document.body）
    await waitFor(() => {
      const dot = document.body.querySelector('[data-testid="billing-provider-group-head"] [role="img"]')
      expect(dot?.getAttribute('aria-label')).toBe('厂商在线')
      expect(dot?.getAttribute('title')).toBe('厂商在线')
    })
  })

  it('探活全挂时：head 徽标健康点带「厂商探活失败」', async () => {
    stubFetch()
    const rendered = render(<UsageBilling {...makeProps({
      checked: true, available: false, models: 0, failures: 2, okProviders: [], badProviders: ['DeepSeek'],
    })} />)
    fireEvent.click(rendered.getByTestId('billing-trigger'))
    await waitFor(() => { expect(rendered.getByTestId('billing-dashboard')).toBeTruthy() })
    await waitFor(() => {
      const dot = document.body.querySelector('[data-testid="billing-dashboard-head"] [role="img"]')
      expect(dot?.getAttribute('aria-label')).toBe('厂商探活失败')
    })
  })
})
