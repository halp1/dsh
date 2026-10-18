/**
 * 路由：GET /api/billing/relay-quotas
 *
 * 中转站额度（New API / Sub2API 余额 + 滚动窗口）。5 分钟缓存 + in-flight
 * 去重。诊断（每条路由的 origin / kind）随响应下发，供「我的中转站为什么不显
 * 示」自查。
 *
 * 路由文件只关心 HTTP 缓存 + 诊断序列化。上游查询（queryRelayQuotas +
 * 路由筛选 + isOfficialBaseUrl 排除）在装配器里跑。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RelayQuota } from '../pricing-shared.ts';
interface CachedRelay {
    quotas: readonly RelayQuota[];
    at: number;
}
/** 路由依赖。 */
export interface RelayQuotasDeps {
    trustedHosts: ReadonlySet<string>;
    cached: () => CachedRelay;
    refreshOnce: () => Promise<void>;
    /** 5 分钟缓存间隔（毫秒）。 */
    cacheMs: number;
}
export declare function registerRelayQuotasRoute(ctx: Context, deps: RelayQuotasDeps): void;
export {};
//# sourceMappingURL=relay-quotas.d.ts.map