/**
 * GET /api/billing/relay-quotas：中转站额度（New API / Sub2API）。
 * 失败抛出（调用方据此保留旧快照）。
 */
import type { RelayQuota } from '../../pricing-shared.ts';
/** Path to the relay-site quota endpoint served by this plugin's node half. */
export declare const RELAY_PATH = "/api/billing/relay-quotas";
/**
 * 拉取中转站额度（New API / Sub2API 的余额与滚动窗口）；失败抛出（调用方据此保留旧快照）。
 * @returns the relay-site quota rows（成功但无中转配置时为空数组）。
 */
export declare function fetchRelayQuotas(): Promise<readonly RelayQuota[]>;
//# sourceMappingURL=relay.d.ts.map