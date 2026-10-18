/**
 * 路由：GET /api/billing/usage-stats
 *
 * 实时用量聚合文档（byDay / byModel / bySession / bySite / byTurn / perf 等）。
 * stale-while-revalidate：聚合是全量扫描（重度用户上万条会话的冷启动折叠以
 * 分钟计），HTTP 请求绝不全程等它——只给 RESPONSE_BUDGET_MS 的等待预算，超
 * 预算立即回最近一次快照；后台折叠完成后快照随之刷新（挂在聚合 promise 上，
 * 与响应路径解耦）。宿主是单进程，慢响应期间事件循环被折叠占住，会话/模型
 * 列表 RPC 会一起饿死（用户反馈的启动卡顿）。
 *
 * 路由文件只关心 HTTP 拼装：
 * - decorate（注入 PACKAGE_VERSION / 预算 / 阈值）
 * - 聚合预算（Promise.race + setTimeout.unref）
 * - 响应体缓存（`statsBodyCache`：装饰 + 序列化结果按 doc 引用 + config 字段
 *   缓存，30s 轮询期间复用）
 * - 失败路径（聚合失败 → 读快照候选 → 仍无则 `{ error }`）
 *
 * 聚合器（`aggregator.aggregate()` / `sessionUsageOf()`）+ 快照读写 + 配置在
 * 装配器里跑，路由只通过 Deps 拿到回调。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { UsageAggregator } from '../aggregate.ts'
import type { UsageBillingConfig } from '../config.ts'
import { guardLoopback } from '../guard.ts'

/** 路由依赖。 */
export interface UsageStatsDeps {
  trustedHosts: ReadonlySet<string>
  /** 聚合器（仅用 .aggregate() 与 .sessionUsageOf()）。 */
  aggregator: Pick<UsageAggregator, 'aggregate' | 'sessionUsageOf'>
  config: UsageBillingConfig
  /** 快照候选路径列表（主文件 + 约定路径 + config.snapshotPath）。 */
  candidates: readonly string[]
  /** 聚合成功后异步落盘节流（30s 内多次触发只写一次）。 */
  persistSnapshot: (doc: Record<string, unknown>) => void
  /** 读一个快照候选：主文件优先，主文件损坏时回退 `.bak`，都失败返回 null。 */
  readSnapshot: (candidate: string) => Promise<Record<string, unknown> | null>
  /** 插件版本（来自 package.json）。 */
  packageVersion: string
  /** 等待预算（毫秒）：聚合在此预算内完成就回实时数据，超预算立即回最近快照。 */
  responseBudgetMs: number
}

export function registerUsageStatsRoute(ctx: Context, deps: UsageStatsDeps): void {
  // 响应体缓存：30s 轮询期间复用同一聚合文档的装饰 + 序列化结果（数百 KiB）。
  let statsBodyCache:
    | { doc: Record<string, unknown>; budget: number | undefined; threshold: number | undefined; body: string }
    | undefined
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: '/api/billing/usage-stats',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guardLoopback(req, res, deps.trustedHosts)) return
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        // 宿主配置（月度预算 / 余额告警阈值）与插件版本不是聚合产物：在响应边界
        // 注入，实时与快照两条路径一致。
        const decorate = (doc: Record<string, unknown>): Record<string, unknown> => ({
          ...doc,
          pluginVersion: deps.packageVersion,
          ...(deps.config.monthlyBudget === undefined ? {} : { budget: deps.config.monthlyBudget }),
          ...(deps.config.lowBalanceThreshold === undefined ? {} : { lowBalanceThreshold: deps.config.lowBalanceThreshold }),
        })
        const statsBodyOf = (doc: Record<string, unknown>): string => {
          const budget = deps.config.monthlyBudget
          const threshold = deps.config.lowBalanceThreshold
          if (statsBodyCache !== undefined && statsBodyCache.doc === doc
            && statsBodyCache.budget === budget && statsBodyCache.threshold === threshold) {
            return statsBodyCache.body
          }
          const body = JSON.stringify(decorate(doc))
          statsBodyCache = { doc, budget, threshold, body }
          return body
        }
        // stale-while-revalidate：见文件头注释；超时立刻回最近一次快照。
        const aggregating = deps.aggregator.aggregate()
        void aggregating.then(
          stats => { deps.persistSnapshot(decorate(stats as unknown as Record<string, unknown>)) },
          () => { /* 失败路径由下方快照兜底，此处只抑制未处理拒绝 */ },
        )
        let fresh: Record<string, unknown> | undefined
        try {
          fresh = await Promise.race([
            aggregating.then(stats => stats as unknown as Record<string, unknown>),
            new Promise<undefined>(resolve => { setTimeout(() => { resolve(undefined) }, deps.responseBudgetMs).unref() }),
          ])
        } catch (error) {
          // Persistence read failed; fall through to the JSON-file candidates.
          // 记录异常尾部（含已折叠会话数），避免「只能靠猜」——聚合失败时用户
          // 至少能从日志看到原因（单会话损坏已在 aggregate 内跳过并告警）。
          console.error('[usage-billing] usage-stats aggregate failed, falling back to snapshot:', error)
        }
        if (fresh !== undefined) {
          res.end(statsBodyOf(fresh))
          return
        }
        for (const candidate of deps.candidates) {
          const doc = await deps.readSnapshot(candidate)
          // Accept only parseable JSON so a stale or partial file never
          // reaches the dashboard as if it were real.
          if (doc === null) continue
          res.end(JSON.stringify(decorate(doc)))
          return
        }
        res.end(JSON.stringify({ error: 'usage stats unavailable' }))
      },
    }),
    'usage-billing: usage-stats route',
  )
}
