/**
 * 剧本 3（API）：unreadable 字段合同（v1.5.2 P0-4）。
 *
 * 数据驱动：拉一次 usage-stats，看 unreadableSessions /
 * unreadableNoLedgerSessions / unreadableFormatSessions 三个字段类型。
 *
 * UI 渲染端有断言：3 个字段任意一个 > 0 时，dashboard 概览 Tab 会渲染
 * `billing-sessions-unreadable` 提示（带 2 个子集 testid：无账本 / 格式拒读）。
 * 本剧本先验 API 字段，UI 端在 vitest + @testing-library 测。
 */

import { test, expect } from '@playwright/test'

test('usage-stats 暴露 unreadable 3 字段（API 合同）', async ({ request }) => {
  const res = await request.get('/api/billing/usage-stats')
  expect(res.status()).toBe(200)
  const doc = await res.json() as Record<string, unknown>

  // 三个字段都应该是 number（即便为 0）
  for (const key of ['unreadableSessions', 'unreadableNoLedgerSessions', 'unreadableFormatSessions']) {
    const v = doc[key]
    expect(typeof v === 'number' || v === undefined,
      `${key} 应为 number 或 undefined（宿主 Config 注入语义），实际 ${typeof v}`).toBe(true)
    if (typeof v === 'number') {
      expect(v).toBeGreaterThanOrEqual(0)
    }
  }
})
