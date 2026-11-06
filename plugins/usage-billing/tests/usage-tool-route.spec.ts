/**
 * /api/billing/usage-tool 路由的状态行纪律与写回失败可诊断性（issue #98 加固）。
 *
 * 直接驱动 registerUsageToolRoute 注册的 handler：写回抛错（宿主 settings.update
 * 的 `No configurable plugin entry`）必须回 503 并带宿主错误文案——v1.6.x 以
 * 200 + {"error":"invalid"} 伪装成功路径，开关无声弹回且网络面板无线索；
 * 每条响应路径 writeHead 第一句且仅一次（413 分支此前二次 writeHead 直接抛
 * ERR_HTTP_HEADERS_SENT）。
 */

import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { registerUsageToolRoute } from '../src/routes/usage-tool.ts'

/** 收集 ctx.effect 里注册的路由描述（webServer.register 的返回值）。 */
function captureRoute(deps: Parameters<typeof registerUsageToolRoute>[1]): {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
} {
  let captured: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> } | undefined
  const ctx = {
    effect(fn: () => unknown) {
      fn()
    },
    webServer: {
      register(opts: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) {
        captured = opts
        return () => {}
      },
    },
  }
  registerUsageToolRoute(ctx as never, deps)
  if (captured === undefined) throw new Error('route was not registered')
  return captured
}

/** 最小请求替身：method/headers + 异步 body 迭代 + 回环 socket（guard 校验用）。 */
function fakeReq(method: string, headers: Record<string, string>, body = ''): IncomingMessage {
  return {
    method,
    headers,
    url: '/api/billing/usage-tool',
    socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1', remotePort: 51000, localPort: 52050 },
    [Symbol.asyncIterator]: async function* () {
      if (body !== '') yield body
    },
  } as unknown as IncomingMessage
}

/** 收集状态行与响应体的响应替身。 */
function fakeRes() {
  const calls: { status?: number; body: string }[] = []
  return {
    calls,
    writeHead(status: number) {
      calls.push({ status, body: '' })
      return this as never
    },
    end(chunk: string) {
      if (calls.length === 0) calls.push({ status: 200, body: '' })
      calls[calls.length - 1]!.body += chunk
    },
  } as unknown as ServerResponse
}

const LOOPBACK_ORIGIN = 'http://127.0.0.1:52050'
const POST_HEADERS = { origin: LOOPBACK_ORIGIN, 'content-type': 'application/json' }

describe('usage-tool route status-line discipline (issue #98)', () => {
  it('answers write failures with 503 and the host error message (not 200 invalid)', async () => {
    const deps = {
      trustedHosts: new Set<string>(),
      read: () => false,
      write: vi.fn(async () => {
        throw new Error('No configurable plugin entry "ui-usage-billing"')
      }),
      syncTool: vi.fn(),
    }
    const { handler } = captureRoute(deps)
    const res = fakeRes()
    await handler(fakeReq('POST', POST_HEADERS, JSON.stringify({ enabled: true })), res)
    expect(res.calls).toHaveLength(1)
    expect(res.calls[0]!.status).toBe(503)
    expect(JSON.parse(res.calls[0]!.body).error).toContain('No configurable plugin entry')
    // 写回失败不得触发工具注册同步（写没成功，注册无意义）。
    expect(deps.syncTool).not.toHaveBeenCalled()
  })

  it('answers success with exactly one 200 status line and the ok body', async () => {
    const deps = {
      trustedHosts: new Set<string>(),
      read: () => true,
      write: vi.fn(async () => {}),
      syncTool: vi.fn(),
    }
    const { handler } = captureRoute(deps)
    const res = fakeRes()
    await handler(fakeReq('POST', POST_HEADERS, JSON.stringify({ enabled: true })), res)
    expect(res.calls).toHaveLength(1)
    expect(res.calls[0]!.status).toBe(200)
    expect(JSON.parse(res.calls[0]!.body)).toEqual({ ok: true, enabled: true })
    expect(deps.syncTool).toHaveBeenCalledTimes(1)
  })

  it('answers malformed JSON with 400 and never double-writeHeads the 413 path', async () => {
    const deps = {
      trustedHosts: new Set<string>(),
      read: () => false,
      write: vi.fn(async () => {}),
      syncTool: vi.fn(),
    }
    const { handler } = captureRoute(deps)
    const bad = fakeRes()
    await handler(fakeReq('POST', POST_HEADERS, '{not-json'), bad)
    expect(bad.calls).toHaveLength(1)
    expect(bad.calls[0]!.status).toBe(400)

    const huge = fakeRes()
    await handler(fakeReq('POST', POST_HEADERS, 'x'.repeat(600)), huge)
    expect(huge.calls).toHaveLength(1)
    expect(huge.calls[0]!.status).toBe(413)
    expect(deps.write).not.toHaveBeenCalled()
  })

  it('keeps the GET shape untouched', async () => {
    const deps = { trustedHosts: new Set<string>(), read: () => true, write: vi.fn(async () => {}), syncTool: vi.fn() }
    const { handler } = captureRoute(deps)
    const res = fakeRes()
    await handler(fakeReq('GET', {}), res)
    expect(res.calls).toHaveLength(1)
    expect(res.calls[0]!.status).toBe(200)
    expect(JSON.parse(res.calls[0]!.body)).toEqual({ enabled: true })
  })
})
