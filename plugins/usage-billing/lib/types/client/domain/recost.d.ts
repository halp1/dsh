/**
 * 用户自定义单价显示重估：聚合发生在宿主进程（按内置目录计价），用户价只在
 * 客户端显示层生效。对 byDayModels（day×model 完整二维）中命中用户价的模型
 * 逐格平价重算 cost，并派生 byDay / byModel / total 的 cost。其余视图
 * （bySite / byTier / bySession / byTurn）保持宿主原值——逐格时刻或行级归属
 * 在客户端不可得，口径差异在设置面板注明。导出供测试：纯函数。
 */
import type { UsageStats } from './types.ts';
export declare function recostWithUserPrices(stats: UsageStats): UsageStats;
//# sourceMappingURL=recost.d.ts.map