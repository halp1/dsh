/**
 * U-3 按模型预算的纯函数：本月每模型消耗聚合与预算档位判定。
 * 导出供测试。
 */
/** 本月每模型消耗：byDayModels（day×model）按月前缀归并 cost。 */
export declare function monthCostByModel(byDayModels: Record<string, Record<string, {
    cost: number;
}>> | undefined, monthPrefix: string): Record<string, number>;
/** 按模型预算档位（百分比）：与全局预算的 BUDGET_ALERT_TIERS 分档口径一致。 */
export declare const MODEL_BUDGET_TIERS: readonly number[];
/** 本月消耗跨过的档位列表（升序）；无预算或未跨档返回空。 */
export declare function crossedModelBudgetTiers(cost: number, budget: number): readonly number[];
//# sourceMappingURL=model-budget.d.ts.map