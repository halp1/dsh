/**
 * 本月预计 / 日均消耗（issue #47）：按日均外推本月总花费；余额可撑天数也复用。
 * 纯函数（日期取本地时区），无 React 依赖。导出供测试。
 */

/**
 * 日均消耗（元/天）：取最近 7 天（含今天）总花费 ÷ 有记录天数；无记录返回 0
 * （此时可用天数无法估算，调用方不显示天数提示）。日期戳字典序即时间序。
 */
export function dailyBurnRate(byDay: Record<string, { cost: number }>, today: string): number {
  const dates = Object.keys(byDay).filter(d => d <= today).sort().slice(-7)
  if (dates.length === 0) return 0
  const total = dates.reduce((sum, d) => sum + (byDay[d]?.cost ?? 0), 0)
  return total / dates.length
}

/**
 * 本月预计总花费：按本月已有记录的平均日消耗 × 本月天数外推；无本月记录时
 * 回退为最近 7 天日均 × 本月天数；无任何记录时返回 0（调用方不展示）。
 * 导出供测试：纯函数，不依赖组件。
 * @param byDay - 按日费用表。
 * @param monthPrefix - 本月前缀（YYYY-MM）。
 * @param today - 今日日期戳（YYYY-MM-DD）。
 * @returns 本月预计花费（人民币元）；无数据时为 0。
 */
export function projectMonthCost(byDay: Record<string, { cost: number }>, monthPrefix: string, today: string): number {
  const dates = Object.keys(byDay).filter(d => d.startsWith(monthPrefix))
  // 预测目标月的总天数：从 monthPrefix（YYYY-MM）解析年月，取当月最后一日的日号。
  // 不能用系统当前月——月初查看上月完整账单时两者错位（如 9 月看 8 月会用 30 天）。
  const parts = monthPrefix.split('-')
  const monthLen = new Date(Number(parts[0]), Number(parts[1]), 0).getDate()
  const avg = dates.length > 0
    ? dates.reduce((sum, d) => sum + (byDay[d]?.cost ?? 0), 0) / dates.length
    : dailyBurnRate(byDay, today)
  if (avg <= 0) return 0
  return avg * monthLen
}
