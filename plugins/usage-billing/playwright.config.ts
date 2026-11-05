/**
 * Playwright e2e 配置（v1.5.2 P0-4）。
 *
 * 3080 dev host 的 UI 路径走 token auth（token 每次启动轮换），Playwright 无法
 * 获取当前 token；in-process DSH host 不带桌面运行时，UI 组件加载不全。
 *
 * 采用 API + UI 双层回归（用户已选）：
 * - 本 config 只跑 API contract specs（testDir: ./tests/api-contract），
 *   `request` fixture 不启 browser，命中 3080 dev host 的 9 条 HTTP 端点
 *   （API 路径无 auth，已 curl 验证 200）。
 * - UI 组件断言在 vitest + @testing-library/react 里走 jsdom（已有 13 个
 *   client spec；新增 3 个覆盖 sidebar trigger / 6 Tab panel / 不可读提示）。
 *
 * 串行（workers: 1）：API 路径共享 3080 host 的内存状态（聚合缓存、in-flight
 * refresh），并发会假阳性。
 *
 * PLAYWRIGHT_BASE_URL 环境变量可改测试目标端口（默认 3080）。
 */

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/api-contract',
  // 串行：3 剧本共享 3080 内存状态。
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3080',
    extraHTTPHeaders: { 'content-type': 'application/json' },
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
})
