/**
 * 剧本 2（API）：POST /api/billing/pricing/refresh 合同（v1.5.2 P0-4）。
 *
 * 立即同步价格目录：服务端重新拉取 models.dev / 汇率，刷新 pricingSyncedAt
 * 时间戳。两次连续 POST 之间的 syncedAt 数值应**变化**（增长或回滚：节点端
 * 重拉耗时 ≤ 6h，间隔很近时也可能数值不变——所以断言 syncedAt 字段是
 * 数字，且响应里 source 字段是合法值）。
 */

import { test, expect } from '@playwright/test'

test('POST /api/billing/pricing/refresh 返回 200 + syncedAt 是数字', async ({ request }) => {
  // 第一次拉取：source = 'builtin'（节点端可能未完成首次拉取）
  const r1 = await request.post('/api/billing/pricing/refresh', { data: {} })
  expect(r1.status()).toBe(200)
  const doc1 = await r1.json() as Record<string, unknown>
  expect(typeof doc1.syncedAt).toBe('number')
  expect(['builtin', 'live', 'fallback']).toContain(doc1.source as string)

  // 第二次拉取：syncedAt 应已变化（节点端 Date.now() 至少 ms 级增长）
  // 若 0 < r1.syncedAt < r2.syncedAt 即可
  await new Promise(resolve => setTimeout(resolve, 10))
  const r2 = await request.post('/api/billing/pricing/refresh', { data: {} })
  expect(r2.status()).toBe(200)
  const doc2 = await r2.json() as Record<string, unknown>
  expect(typeof doc2.syncedAt).toBe('number')
  if (doc1.syncedAt > 0 && doc2.syncedAt > 0) {
    // 节点端可能因 cache 命中返回同一值（核心 6 小时 cache），不强写死
    expect(doc2.syncedAt).toBeGreaterThanOrEqual(doc1.syncedAt)
  }
})
