/**
 * U-3 按模型预算的纯函数：本月每模型消耗聚合与预算档位判定。
 * 导出供测试。
 */

/** 本月每模型消耗：byDayModels（day×model）按月前缀归并 cost。 */
export function monthCostByModel(
  byDayModels: Record<string, Record<string, { cost: number }>> | undefined,
  monthPrefix: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (byDayModels === undefined) return out
  for (const [date, models] of Object.entries(byDayModels)) {
    if (!date.startsWith(monthPrefix)) continue
    for (const [key, cell] of Object.entries(models)) {
      out[key] = (out[key] ?? 0) + cell.cost
    }
  }
  return out
}

/** 按模型预算档位（百分比）：与全局预算的 BUDGET_ALERT_TIERS 分档口径一致。 */
export const MODEL_BUDGET_TIERS: readonly number[] = [80, 100]

/** 本月消耗跨过的档位列表（升序）；无预算或未跨档返回空。 */
export function crossedModelBudgetTiers(cost: number, budget: number): readonly number[] {
  if (!(budget > 0) || !(cost > 0)) return []
  const pct = (cost / budget) * 100
  return MODEL_BUDGET_TIERS.filter(tier => pct >= tier)
}
