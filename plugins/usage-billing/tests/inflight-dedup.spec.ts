/**
 * balance / subscriptions / relay-quotas 三条轮询路由的 in-flight 去重
 * （2026-10 稳定性轮延期项）：仪表盘弹窗、悬浮费用条与 usage-stats 工具会
 * 并发打同一批端点；缓存过期的瞬间，多个在途请求各自触发一整套上游刷新
 * （订阅 = 逐 provider 鉴权 + 拉额度），去重后并发请求必须共享同一次刷新。
 *
 * 以 subscriptions 路由为代表验证（三处是同一包装模式的三个实例）：把
 * collectSubscriptions 换成受控的慢上游，两个并发请求期间它只被调一次，
 * 且两个响应拿到同一份结果。
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as UsageBilling from '../src/index.ts'
import { collectSubscriptions } from '../src/subscriptions.ts'

vi.mock('../src/subscriptions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/subscriptions.ts')>()
  return { ...actual, collectSubscriptions: vi.fn() }
})

let root: string | undefined

beforeEach(() => {
  // 外网一律拒绝：定价拉取立即降级 builtin，测试不触网。
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    throw new Error(`offline in test: ${String(input)}`)
  }))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.mocked(collectSubscriptions).mockReset()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** 回环 GET 请求的最小替身（过 guardLoopback 的 peer + host 双校验）。 */
function loopbackGet(): IncomingMessage {
  return {
    method: 'GET',
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage
}

/** 捕获响应体的 res 替身。 */
function resDouble(): { res: ServerResponse; body: () => string } {
  let payload = ''
  const res = {
    writeHead: () => {},
    end: (chunk?: string) => { if (chunk !== undefined) payload = String(chunk) },
  } as unknown as ServerResponse
  return { res, body: () => payload }
}

describe('refresh in-flight dedup on polled routes', () => {
  it('shares one upstream subscription refresh across concurrent requests', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-inflight-'))
    // 受控慢上游：第一次调用挂起直到放行；默认实现立即返回——若去重失效出现
    // 第二次调用，它能立刻完成并在最终断言（调用次数）上暴露。
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.mocked(collectSubscriptions).mockImplementationOnce(async () => {
      await gate
      return []
    })
    vi.mocked(collectSubscriptions).mockImplementation(async () => [])
    const routes: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }[] = []
    const webServerDouble = {
      name: 'test-inflight-webserver',
      apply(child: Context): void {
        child.provide('webServer', {
          register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) => {
            routes.push(route)
            return () => {}
          },
        })
      },
    }
    const ctx = new Context()
    await ctx.plugin({
      name: 'test-inflight-persistence',
      apply(child: Context): void {
        child.provide('sessionPersistence', {
          list: async () => [],
          readFrom: async () => ({ meta: { id: 's0' }, events: [] }),
        } as unknown as SessionPersistence)
      },
    })
    await ctx.plugin({
      name: 'test-inflight-credentials',
      apply(child: Context): void {
        child.provide('credentials', { resolve: async () => undefined } as unknown as CredentialProvider)
      },
    })
    await ctx.plugin({
      name: 'test-inflight-settings',
      apply(child: Context): void {
        child.provide('settings', { describe: () => [], update: async () => {} } as unknown as SettingsProvider)
      },
    })
    await ctx.plugin(webServerDouble)
    await ctx.plugin({ ...UsageBilling, Config: undefined } as never, {
      snapshotPath: join(root, 'usage-stats.json'),
      ledgerPath: join(root, 'usage-ledger.json'),
      reconcilePath: join(root, 'usage-reconcile.json'),
    })

    const subscriptionsRoute = routes.find(route => route.path === '/api/billing/subscriptions')
    expect(subscriptionsRoute).toBeDefined()

    // 缓存冷启动（at=0）：第一个请求触发慢上游；等到它确实在途。
    const first = resDouble()
    const second = resDouble()
    const p1 = subscriptionsRoute!.handler(loopbackGet(), first.res)
    await vi.waitFor(() => expect(collectSubscriptions).toHaveBeenCalledTimes(1))
    // 上游仍在途时第二个请求进入：共享同一次刷新。
    const p2 = subscriptionsRoute!.handler(loopbackGet(), second.res)
    release()
    await Promise.all([p1, p2])
    // 若去重失效，第二个请求会带着默认 mock 再打一次上游 → 计数变 2。
    expect(collectSubscriptions).toHaveBeenCalledTimes(1)
    // 两个响应同形同值：都拿到刷新后的同一份 quotas。
    expect(first.body()).toBe(second.body())
    expect(JSON.parse(first.body())).toEqual({ quotas: [] })
  })
})
