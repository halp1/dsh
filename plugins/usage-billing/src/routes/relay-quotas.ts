/**
 * 路由：GET /api/billing/relay-quotas
 *
 * 中转站额度（New API / Sub2API 余额 + 滚动窗口）。5 分钟缓存 + in-flight
 * 去重。诊断（每条路由的 origin / kind）随响应下发，供「我的中转站为什么不显
 * 示」自查。
 *
 * 路由文件只关心 HTTP 缓存 + 诊断序列化。上游查询（queryRelayQuotas +
 * 路由筛选 + isOfficialBaseUrl 排除）在装配器里跑。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RelayQuota } from '../pricing-shared.ts'
import { guardLoopback } from '../guard.ts'

interface CachedRelay {
  quotas: readonly RelayQuota[]
  at: number
}

/** 路由依赖。 */
export interface RelayQuotasDeps {
  trustedHosts: ReadonlySet<string>
  cached: () => CachedRelay
  refreshOnce: () => Promise<void>
  /** 5 分钟缓存间隔（毫秒）。 */
  cacheMs: number
}

export function registerRelayQuotasRoute(ctx: Context, deps: RelayQuotasDeps): void {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/billing/relay-quotas',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guardLoopback(req, res, deps.trustedHosts)) return
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        if (Date.now() - deps.cached().at >= deps.cacheMs) {
          try {
            await deps.refreshOnce()
          } catch (error) {
            // 刷新意外抛错时仍用旧缓存响应，绝不让已 writeHead 的响应挂起。
            console.warn('[usage-billing] refreshRelay failed; serving cached relay quotas:', error)
          }
        }
        // 诊断：每条路由的归类（origin / kind），供「我的中转站为什么不显示」自查。
        const diagnostics = deps.cached().quotas.map(row => ({ route: row.route, origin: row.origin, kind: row.kind }))
        res.end(JSON.stringify({ quotas: deps.cached().quotas, diagnostics }))
      },
    }),
    'usage-billing: relay-quotas route',
  )
}
