/**
 * 路由：GET /api/billing/usage-stats
 *
 * 实时用量聚合文档（byDay / byModel / bySession / bySite / byTurn / perf 等）。
 * stale-while-revalidate：聚合是全量扫描（重度用户上万条会话的冷启动折叠以
 * 分钟计），HTTP 请求绝不全程等它——只给 RESPONSE_BUDGET_MS 的等待预算，超
 * 预算立即回最近一次快照；后台折叠完成后快照随之刷新（挂在聚合 promise 上，
 * 与响应路径解耦）。宿主是单进程，慢响应期间事件循环被折叠占住，会话/模型
 * 列表 RPC 会一起饿死（用户反馈的启动卡顿）。
 *
 * 路由文件只关心 HTTP 拼装：
 * - decorate（注入 PACKAGE_VERSION / 预算 / 阈值）
 * - 聚合预算（Promise.race + setTimeout.unref）
 * - 响应体缓存（`statsBodyCache`：装饰 + 序列化结果按 doc 引用 + config 字段
 *   缓存，30s 轮询期间复用）
 * - 失败路径（聚合失败 → 读快照候选 → 仍无则 `{ error }`）
 *
 * 聚合器（`aggregator.aggregate()` / `sessionUsageOf()`）+ 快照读写 + 配置在
 * 装配器里跑，路由只通过 Deps 拿到回调。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { UsageAggregator } from '../aggregate.ts';
import type { UsageBillingConfig } from '../config.ts';
/** 路由依赖。 */
export interface UsageStatsDeps {
    trustedHosts: ReadonlySet<string>;
    /** 聚合器（仅用 .aggregate() 与 .sessionUsageOf()）。 */
    aggregator: Pick<UsageAggregator, 'aggregate' | 'sessionUsageOf'>;
    config: UsageBillingConfig;
    /** 快照候选路径列表（主文件 + 约定路径 + config.snapshotPath）。 */
    candidates: readonly string[];
    /** 聚合成功后异步落盘节流（30s 内多次触发只写一次）。 */
    persistSnapshot: (doc: Record<string, unknown>) => void;
    /** 读一个快照候选：主文件优先，主文件损坏时回退 `.bak`，都失败返回 null。 */
    readSnapshot: (candidate: string) => Promise<Record<string, unknown> | null>;
    /** 插件版本（来自 package.json）。 */
    packageVersion: string;
    /** 等待预算（毫秒）：聚合在此预算内完成就回实时数据，超预算立即回最近快照。 */
    responseBudgetMs: number;
}
export declare function registerUsageStatsRoute(ctx: Context, deps: UsageStatsDeps): void;
//# sourceMappingURL=usage-stats.d.ts.map