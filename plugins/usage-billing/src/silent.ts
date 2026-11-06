/**
 * 静默吞错的结构化记录（S-6）：「缺失=未配置」类 catch 的统一出口。
 *
 * 本仓 78 处 server 端 catch 多数是有意的静默（文件缺失=首次运行、凭据未
 * 配置=跳过该 provider），此前唯一载体是注释——用户报「X 不工作」时只能靠
 * 猜。本工具把这些静默升级为**节流的结构化日志**：同 reason 5 分钟最多一条
 * info，宿主日志可 grep `swallowed:`，诊断时看得到「哪个环节吞了什么」，
 * 而又不把已知常态刷成告警噪音。
 *
 * 不取代 console.warn——已知异常需要用户行动的（账本损坏、刷新失败）继续
 * warn；这里只收「确认无害的静默」。节流状态导出重置仅供测试。
 */

const THROTTLE_MS = 5 * 60_000

const lastLoggedAt = new Map<string, number>()

/**
 * 记录一次有意的静默吞错。
 * @param reason - 稳定的短横线 reason 键（如 `reconcile-ref-missing`），节流以此为粒度。
 * @param error - 可选的原始异常（Error 打 message，其他值原样）。
 */
export function swallowed(reason: string, error?: unknown): void {
  const now = Date.now()
  const last = lastLoggedAt.get(reason)
  if (last !== undefined && now - last < THROTTLE_MS) return
  lastLoggedAt.set(reason, now)
  if (error === undefined) {
    console.info(`[usage-billing] swallowed: ${reason}`)
    return
  }
  console.info(`[usage-billing] swallowed: ${reason}`, error instanceof Error ? error.message : error)
}

/** 清空节流状态（仅供测试：模块级 Map 会跨用例泄漏）。 */
export function resetSwallowedForTest(): void {
  lastLoggedAt.clear()
}
