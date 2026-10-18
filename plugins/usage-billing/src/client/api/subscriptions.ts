/**
 * GET /api/billing/subscriptions：订阅套餐剩余额度（供订阅面板）。
 * 失败抛出（调用方据此保留旧快照）。
 */

import type { SubscriptionQuota, SubscriptionResponse } from '../../pricing-shared.ts'

/** Path to the subscription-plan quota endpoint served by this plugin's node half. */
export const SUBSCRIPTIONS_PATH = '/api/billing/subscriptions'

/**
 * 拉取订阅套餐剩余额度（供订阅面板）；失败返回空列表。
 * @returns the quota rows, or an empty list on any failure.
 */
export async function fetchSubscriptions(): Promise<readonly SubscriptionQuota[]> {
  const response = await fetch(SUBSCRIPTIONS_PATH)
  if (!response.ok) throw new Error(`subscriptions HTTP ${String(response.status)}`)
  const text = await response.text()
  const parsed = JSON.parse(text) as unknown
  if (parsed !== null && typeof parsed === 'object' && 'quotas' in parsed) {
    return (parsed as SubscriptionResponse).quotas
  }
  throw new Error('subscriptions: invalid response')
}
