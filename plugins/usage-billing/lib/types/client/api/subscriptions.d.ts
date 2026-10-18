/**
 * GET /api/billing/subscriptions：订阅套餐剩余额度（供订阅面板）。
 * 失败抛出（调用方据此保留旧快照）。
 */
import type { SubscriptionQuota } from '../../pricing-shared.ts';
/** Path to the subscription-plan quota endpoint served by this plugin's node half. */
export declare const SUBSCRIPTIONS_PATH = "/api/billing/subscriptions";
/**
 * 拉取订阅套餐剩余额度（供订阅面板）；失败返回空列表。
 * @returns the quota rows, or an empty list on any failure.
 */
export declare function fetchSubscriptions(): Promise<readonly SubscriptionQuota[]>;
//# sourceMappingURL=subscriptions.d.ts.map