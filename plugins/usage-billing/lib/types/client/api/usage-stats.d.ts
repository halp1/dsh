/**
 * GET /api/billing/usage-stats：服务端聚合文档（含 byDay/byModel/bySession/...）。
 * 旧快照可能缺字段（聚合升级前落盘），解析时按字段白名单接受并兜底——避免
 * 渲染路径读 undefined 抛错导致整个插件 surface 被卸载。
 */
import type { UsageStats } from '../domain/types.ts';
/** Path to the usage-stats endpoint served by this plugin's node half. */
export declare const USAGE_STATS_PATH = "/api/billing/usage-stats";
/** Try to load stats from the server; returns null when no valid JSON stats are served. */
export declare function loadUsageStats(): Promise<UsageStats | null>;
//# sourceMappingURL=usage-stats.d.ts.map