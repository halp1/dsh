/**
 * 路由：GET /api/billing/balance
 *
 * 多平台余额（DeepSeek / Kimi / StepFun / SiliconFlow / xAI / 智谱 / 腾讯云
 * TokenHub 等）+ 用户自定义余额 + 声明端点 + 余额差对账。5 分钟缓存（避免
 * 每 30s 后台轮询打上游），in-flight 去重（并发请求共享同一次进行中的刷新）。
 *
 * 路由文件只关心 HTTP 缓存逻辑：5 分钟过期判定 + 失败时仍发旧缓存（不挂起
 * 已 writeHead 的响应）。上游查询（queryBalances / queryCustomBalances /
 * queryDeclaredEndpoints / reconcileBalanceDelta）在装配器里跑，路由只通过
 * `cached()` 与 `refreshOnce()` 拿到结果。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ProviderBalance } from '../pricing-shared.ts';
import type { ReconcileEvent } from '../reconcile.ts';
/** 余额响应体形状（来自装配器 `balanceCache.doc`）。 */
export interface BalanceDoc {
    balances: readonly ProviderBalance[];
    reconcile?: ReconcileEvent;
}
interface CachedBalance {
    doc: BalanceDoc;
    at: number;
}
/** 路由依赖。 */
export interface BalanceDeps {
    trustedHosts: ReadonlySet<string>;
    /** 装配器内缓存 + 时间戳（`Date.now()`）。 */
    cached: () => CachedBalance;
    /** in-flight 去重的刷新入口。 */
    refreshOnce: () => Promise<void>;
    /** 5 分钟缓存间隔（毫秒）。 */
    cacheMs: number;
}
export declare function registerBalanceRoute(ctx: Context, deps: BalanceDeps): void;
export {};
//# sourceMappingURL=balance.d.ts.map