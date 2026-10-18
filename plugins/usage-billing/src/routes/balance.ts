/**
 * 路由：GET /api/billing/balance
 *
 * 多平台余额（DeepSeek / Kimi / StepFun / SiliconFlow / xAI / 智谱 / 腾讯云
 * TokenHub 等）+ 用户自定义余额 + 声明端点 + 余额差对账。5 分钟缓存（避免
 * 每 30s 后台轮询打上游），in-flight 去重（并发请求共享同一次进行中的刷新）。
 *
 * 路由文件只关心 HTTP 缓存逻辑：5 分钟过期判定 + 失败时仍发旧缓存（不挂起
 * 已 writeHead 的响应）。上游查询（queryBalances / queryCustomBalances /
 * queryDeclaredEndpoints / reconcileBalanceDelta）在装配器里跑，路由只通过
 * `cached()` 与 `refreshOnce()` 拿到结果。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProviderBalance } from '../pricing-shared.ts'
import type { ReconcileEvent } from '../reconcile.ts'
import { guardLoopback } from '../guard.ts'

/** 余额响应体形状（来自装配器 `balanceCache.doc`）。 */
export interface BalanceDoc {
  balances: readonly ProviderBalance[]
  reconcile?: ReconcileEvent
}

interface CachedBalance {
  doc: BalanceDoc
  at: number
}

/** 路由依赖。 */
export interface BalanceDeps {
  trustedHosts: ReadonlySet<string>
  /** 装配器内缓存 + 时间戳（`Date.now()`）。 */
  cached: () => CachedBalance
  /** in-flight 去重的刷新入口。 */
  refreshOnce: () => Promise<void>
  /** 5 分钟缓存间隔（毫秒）。 */
  cacheMs: number
}

export function registerBalanceRoute(ctx: Context, deps: BalanceDeps): void {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/billing/balance',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guardLoopback(req, res, deps.trustedHosts)) return
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        // 外部余额 API 低频变化：缓存 5 分钟，命中直接返回，避免每 30 秒后台轮询都打上游。
        if (Date.now() - deps.cached().at < deps.cacheMs) {
          res.end(JSON.stringify(deps.cached().doc))
          return
        }
        try {
          await deps.refreshOnce()
        } catch (error) {
          // 查询失败：保留上次成功快照（从未成功则为空余额），避免每 30 秒把偶发故障刷成「未配置」。
          console.warn('[usage-billing] refreshBalances failed; serving cached balances:', error)
        }
        res.end(JSON.stringify(deps.cached().doc))
      },
    }),
    'usage-billing: balance route',
  )
}
