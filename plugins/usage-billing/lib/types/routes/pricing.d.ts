/**
 * 路由：GET /api/billing/pricing + POST /api/billing/pricing/refresh
 *
 * 实时定价（汇率 + OpenRouter 模型价 + models.dev 目录外补充）的 GET/POST 同
 * concern，合一个文件：
 * - GET 由前端 30s 轮询 + 弹窗初始拉取触发，返回完整价目表文档（live + 内置
 *   目录 + 别名表 + syncedAt）。
 * - POST 是费率条「立即同步」按钮触发，强制服务端重新拉取一次；写操作额外
 *   校验 Origin 与 Content-Type。
 *
 * 路由文件只关心 HTTP 层：响应体序列化与缓存（pricingBodyCache）由 index.ts
 * 装配器通过 `body()` 闭包注入；服务端重拉逻辑（refreshPricing + 价格目录代际
 * 变化触发 reprice）也在装配器里，路由只通过 `refresh()` 触发。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 路由依赖：装配器注入。 */
export interface PricingDeps {
    trustedHosts: ReadonlySet<string>;
    /** 装配器内缓存的序列化响应体（含 live + 内置目录 + 别名 + syncedAt）。 */
    body: () => string;
    /** 触发服务端重新拉取 models.dev / 汇率。 */
    refresh: () => Promise<void>;
}
/** 一次性注册两条同 concern 路由。 */
export declare function registerPricingRoutes(ctx: Context, deps: PricingDeps): void;
//# sourceMappingURL=pricing.d.ts.map