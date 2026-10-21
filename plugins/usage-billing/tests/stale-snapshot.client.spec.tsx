// @vitest-environment jsdom
/**
 * UI 剧本（jsdom + @testing-library）：服务端回落下发（聚合超预算/失败）时，
 * 面板显式提示「数据来自上一次计算」。
 *
 * 背景（issue #103）：重命名会话后账单明细仍显示旧标题——用户把「上一次计算」
 * 的旧值当成了最新值读。提示让滞后可见：文档带 staleSnapshot 时标题栏下出现
 * 一行提示，所有页签都看得见。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { UsageBilling } from '../src/client/UsageBilling.tsx'
import { notifiedKeys } from '../src/client/domain/notify.ts'
import { createBillingBudgetStore } from '../src/client/budget-store.ts'
import { bindSnapshotSelector } from './bind-snapshot-selector'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  localStorage.clear()
  notifiedKeys.clear()
})

const t = (key: string): string => (zh as Record<string, string>)[key] ?? key

/** 构造 usage-stats 响应：staleSnapshot 决定是否带滞后标记。 */
function stubUsageStats(staleSnapshot: boolean): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/billing/usage-stats')) {
      return new Response(JSON.stringify({
        total: { calls: 1, input: 10, output: 5, cacheHit: 0, cacheMiss: 10, cost: 0.1, reasoning: 0 },
        byModel: {}, byDay: {}, byDayModels: {}, byDayModelsSite: {},
        updatedAt: 1_700_000_000_000,
        ...(staleSnapshot ? { staleSnapshot: true } : {}),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch)
}

/** 渲染面板并打开 Modal。 */
async function openDashboard(): Promise<ReturnType<typeof render>> {
  const budgetStore = createBillingBudgetStore().create()
  const props = {
    wide: true,
    t,
    checkModels: async () => ({
      checked: true, available: true, models: 0, failures: 0, okProviders: [], badProviders: [],
    }),
    publishCosts: () => {},
    registerOpen: () => () => {},
    renderSlot: () => null,
    useStore: bindSnapshotSelector(budgetStore),
    actions: budgetStore.actions,
  } as unknown as Parameters<typeof UsageBilling>[0]

  const view = render(<UsageBilling {...props} />)
  fireEvent.click(view.getByTestId('billing-trigger'))
  await waitFor(() => {
    expect(view.getByTestId('billing-dashboard')).toBeTruthy()
  })
  return view
}

describe('滞后数据提示（issue #103）', () => {
  it('staleSnapshot=true 时提示可见，实时数据时不提示', async () => {
    stubUsageStats(true)
    const { getByTestId, queryByTestId } = await openDashboard()
    await waitFor(() => {
      expect(getByTestId('billing-stale-snapshot')).toBeTruthy()
    })
    // 提示文案来自中文字典（面板按宿主语言取，测试固定 zh 字典）。
    expect(getByTestId('billing-stale-snapshot').textContent).toContain(t('staleSnapshotNotice'))
    // 实时数据（无 staleSnapshot）不出现提示。
    cleanup()
    stubUsageStats(false)
    const fresh = await openDashboard()
    await waitFor(() => {
      expect(fresh.getByTestId('billing-dashboard')).toBeTruthy()
    })
    expect(queryByTestId('billing-stale-snapshot')).toBeNull()
  })
})
