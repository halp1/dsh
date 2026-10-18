/**
 * 路由：GET /api/billing/subscriptions
 *
 * 订阅套餐额度（Kimi / Z.ai Coding / OpenCode / MiniMax / OpenRouter / Claude /
 * CommandCode / 腾讯云 TokenHub 等）。5 分钟缓存 + in-flight 去重（与 balance
 * 同模式——并发请求共享同一次进行中的刷新）。
 *
 * 路由文件只关心 HTTP 缓存逻辑：超时或未命中时触发 refreshOnce，失败时仍用
 * 旧缓存（不挂起已 writeHead 的响应）。上游查询（collectSubscriptions +
 * resolveSubscriptionKeys + 适配器 + 套餐知识库）在装配器里跑。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SubscriptionQuota } from '../pricing-shared.ts';
interface CachedQuotas {
    quotas: readonly SubscriptionQuota[];
    at: number;
}
/** 路由依赖。 */
export interface SubscriptionsDeps {
    trustedHosts: ReadonlySet<string>;
    cached: () => CachedQuotas;
    refreshOnce: () => Promise<void>;
    /** 5 分钟缓存间隔（毫秒）。 */
    cacheMs: number;
}
export declare function registerSubscriptionsRoute(ctx: Context, deps: SubscriptionsDeps): void;
export {};
//# sourceMappingURL=subscriptions.d.ts.map