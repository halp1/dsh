/**
 * 本月预计 / 日均消耗（issue #47）：按日均外推本月总花费；余额可撑天数也复用。
 * 纯函数（日期取本地时区），无 React 依赖。导出供测试。
 */
/**
 * 日均消耗（元/天）：取最近 7 天（含今天）总花费 ÷ 有记录天数；无记录返回 0
 * （此时可用天数无法估算，调用方不显示天数提示）。日期戳字典序即时间序。
 */
export declare function dailyBurnRate(byDay: Record<string, {
    cost: number;
}>, today: string): number;
/**
 * 本月预计总花费：按本月已有记录的平均日消耗 × 本月天数外推；无本月记录时
 * 回退为最近 7 天日均 × 本月天数；无任何记录时返回 0（调用方不展示）。
 * 导出供测试：纯函数，不依赖组件。
 * @param byDay - 按日费用表。
 * @param monthPrefix - 本月前缀（YYYY-MM）。
 * @param today - 今日日期戳（YYYY-MM-DD）。
 * @returns 本月预计花费（人民币元）；无数据时为 0。
 */
export declare function projectMonthCost(byDay: Record<string, {
    cost: number;
}>, monthPrefix: string, today: string): number;
//# sourceMappingURL=forecast.d.ts.map