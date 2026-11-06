/**
 * 按日活跃统计：活跃天数、连续使用天数、单日 token 口径。
 * `dayTokensOf` 是全仓按日 Token 的统一口径（输入 + 输出，与 cacheHit/cacheMiss
 * 互斥——stats.input 已含两者），趋势图 / 热力图 / 触发卡 / KPI 峰值日一律走它。
 */

import { localDayStamp } from '../pricing.ts'

/** 近 7 天费用序列（含今天，缺日补 0）：触发卡 hover 速览的迷你柱数据源。
 * 导出供测试：纯函数（日期取本地时区）。 */
export function activeDaysOf(byDay: Record<string, { cost: number }>): number {
  return Object.keys(byDay).length
}

/** 连续使用天数：从今天往前连续「有调用记录」的天数；今天无记录则为 0。
 * 导出供测试：纯函数（日期取本地时区）。 */
export function streakDaysOf(byDay: Record<string, { cost: number }>, now = Date.now()): number {
  let streak = 0
  const cursor = new Date(now)
  for (;;) {
    const key = localDayStamp(cursor.getTime())
    if (!(key in byDay)) break
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 按日 Token 口径：输入 + 输出。stats.input 本身已含缓存命中与未命中
 * （aggregate foldUsage：input = cacheHit + cacheMiss），再叠加缓存字段即重复
 * 计数——趋势图/热力图/触发卡/峰值日的按日 Token 一律走本函数（issue #85）；
 * 跨日合计在各行之上累加（KPI 见 kpiAgg，触发卡见 month/weekTokens）。
 * 导出供测试：纯函数。 */
export function dayTokensOf(day: { input: number; output: number }): number {
  return day.input + day.output
}
