// @vitest-environment jsdom
/**
 * U-4：设置页全文搜索。
 *
 * 纯函数（settingsSectionHidden）+ 组件集成（打开设置 Tab → 输入查询 →
 * 关键词未命中的分区隐藏、命中的保留、清空恢复、全不命中显示空态提示）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { UsageBilling } from '../src/client/UsageBilling.tsx'
import { settingsSectionHidden } from '../src/client/settings-search.ts'
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

describe('settingsSectionHidden（纯函数）', () => {
  const keywords = ['预算', 'budget', '金额']

  it('空查询 / 纯空白不隐藏任何分区', () => {
    expect(settingsSectionHidden('', keywords)).toBe(false)
    expect(settingsSectionHidden('   ', keywords)).toBe(false)
  })

  it('关键词命中（精确子串 / 大小写不敏感）不隐藏', () => {
    expect(settingsSectionHidden('预算', keywords)).toBe(false)
    expect(settingsSectionHidden('BUDGET', keywords)).toBe(false)
    expect(settingsSectionHidden('dget', keywords)).toBe(false)
  })

  it('无命中隐藏', () => {
    expect(settingsSectionHidden('峰谷', keywords)).toBe(true)
  })
})

describe('设置页搜索（组件集成）', () => {
  function makeProps(): ComponentProps<typeof UsageBilling> {
    const budgetStore = createBillingBudgetStore().create()
    return {
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
    } as unknown as ComponentProps<typeof UsageBilling>
  }

  function stubFetch(): void {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/billing/usage-stats')) {
        return new Response(JSON.stringify({
          total: { calls: 0, input: 0, output: 0, cacheHit: 0, cacheMiss: 0, cost: 0, reasoning: 0 },
          byModel: {}, byDay: {}, byDayModels: {}, byDayModelsSite: {},
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch)
  }

  async function openSettings(): Promise<{
    getByTestId: (id: string) => HTMLElement
    queryByTestId: (id: string) => HTMLElement | null
  }> {
    stubFetch()
    const rendered = render(<UsageBilling {...makeProps()} />)
    fireEvent.click(rendered.getByTestId('billing-trigger'))
    await waitFor(() => { expect(rendered.getByTestId('billing-dashboard')).toBeTruthy() })
    fireEvent.click(rendered.getByTestId('billing-tab-settings'))
    await waitFor(() => { expect(rendered.getByTestId('billing-tab-panel-settings')).toBeTruthy() })
    return rendered
  }

  it('搜索「峰谷」：预算卡隐藏、峰谷卡保留', async () => {
    const { getByTestId, queryByTestId } = await openSettings()
    const input = getByTestId('billing-settings-search')
    fireEvent.change(input, { target: { value: '峰谷' } })
    await waitFor(() => {
      // hidden 属性反映到 DOM
      expect(getByTestId('billing-budget').hidden).toBe(true)
      expect(getByTestId('billing-peak-alert-settings').hidden).toBe(false)
    })
  })

  it('清空搜索：全部分区恢复显示', async () => {
    const { getByTestId } = await openSettings()
    const input = getByTestId('billing-settings-search')
    fireEvent.change(input, { target: { value: '峰谷' } })
    await waitFor(() => { expect(getByTestId('billing-budget').hidden).toBe(true) })
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => { expect(getByTestId('billing-budget').hidden).toBe(false) })
  })

  it('全部不命中：显示空态提示', async () => {
    const { getByTestId, queryByTestId } = await openSettings()
    const input = getByTestId('billing-settings-search')
    fireEvent.change(input, { target: { value: '不存在的关键词xyz' } })
    await waitFor(() => {
      expect(getByTestId('billing-budget').hidden).toBe(true)
      expect(queryByTestId('billing-settings-search-empty')).not.toBeNull()
    })
  })
})
