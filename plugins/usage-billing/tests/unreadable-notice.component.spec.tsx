// @vitest-environment jsdom
/**
 * UI 剧本 3（jsdom + @testing-library）：不可读会话提示存在时渲染（v1.5.2 P0-4）。
 *
 * 数据驱动：构造一份 stats 含 unreadableSessions=3 的快照，打开 Modal 切到
 * 概览 Tab，断言 `billing-sessions-unreadable` 提示 + 2 个子集 testid
 * 可见。这是 v1.4.22 issue #84 的核心可见性回归守护。
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

describe('不可读会话提示（issue #84 三态分流）', () => {
  it('unreadableSessions=3 + 2 个子集>0 时，三个 testid 全部可见', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/billing/usage-stats')) {
        return new Response(JSON.stringify({
          total: { calls: 0, input: 0, output: 0, cacheHit: 0, cacheMiss: 0, cost: 0, reasoning: 0 },
          byModel: {}, byDay: {}, byDayModels: {}, byDayModelsSite: {},
          unreadableSessions: 3,
          unreadableNoLedgerSessions: 1,
          unreadableFormatSessions: 2,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch)

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

    const { getByTestId } = render(<UsageBilling {...props} />)

    // 打开 Modal
    fireEvent.click(getByTestId('billing-trigger'))
    await waitFor(() => {
      expect(getByTestId('billing-dashboard')).toBeTruthy()
    })

    // 切到概览 tab（默认就是，但保险点一下）
    fireEvent.click(getByTestId('billing-tab-overview'))
    // 父提示 + 2 个子集
    expect(getByTestId('billing-sessions-unreadable')).toBeTruthy()
    expect(getByTestId('billing-sessions-no-ledger')).toBeTruthy()
    expect(getByTestId('billing-sessions-format-unsupported')).toBeTruthy()
  })
})
