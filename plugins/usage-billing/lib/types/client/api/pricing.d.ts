/**
 * GET /api/billing/pricing + POST /api/billing/pricing/refresh：实时定价。
 * 节点端启动时拉取，pricing source = 'builtin' 时本地内置（首次启动会回退
 * 内置价）；重试链在收到完整 live 文档时立即结算。`livePricingRetryPending`
 * 与 `lastPricingSyncedAt` 是模块级 let，**必须**与 `loadLivePricing` 同文件
 * 保留（防止跨文件共享 mutable state；也是测试唯一可读的同步基线）。
 */
/** Path to the live-pricing endpoint served by this plugin's node half. */
export declare const PRICING_PATH = "/api/billing/pricing";
/** Path to the manual pricing-sync endpoint (POST) served by this plugin's node half. */
export declare const PRICING_REFRESH_PATH = "/api/billing/pricing/refresh";
/** 上次价格目录同步完成的本机时间戳（毫秒）：loadLivePricing 每次拿到完整
 *  pricing 文档时更新；组件渲染时读取，手动同步后经 setState 触发重渲染刷新。
 * `export let` 让 ESM live binding 暴露给外部——只读绑定（`import { x }` 在 ESM
 * 中为只读），唯一写入点在本模块内 `lastPricingSyncedAt = ...`。 */
export declare let lastPricingSyncedAt: number;
declare function loadLivePricing(attempt?: number): Promise<void>;
/**
 * 手动同步价格目录：POST /api/billing/pricing/refresh 让服务端立刻重拉
 * models.dev / 汇率，随后重载 pricing 文档并刷新界面。失败静默保持现状。
 * @returns 同步是否成功（供按钮态展示降级）。
 */
export declare function syncPricingNow(): Promise<boolean>;
/** 公开 loadLivePricing 供 UsageBilling 触发器/弹窗挂载时调用。 */
export { loadLivePricing };
//# sourceMappingURL=pricing.d.ts.map