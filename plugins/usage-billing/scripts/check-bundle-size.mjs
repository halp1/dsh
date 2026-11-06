#!/usr/bin/env node
/**
 * check-bundle-size.mjs: client bundle size guard (`pnpm size`).
 *
 * The 256 KiB and 500 KiB lines below are a self-imposed cost guard. They make
 * the size growth of new features visible on every build instead of waiting for
 * users to notice slower loads.
 *
 * 行为：
 * - 读取 lib/client.js（浏览器分发面）字节数。
 * - 超软线（256 KiB）：打印提示，退出 0——提醒评审本次体积增量是否值得。
 * - 超强线（500 KiB）：打印警告，退出 1——应当立刻着手压缩。
 * - 产物缺失（未构建）：打印 skip，退出 0——CI 中该步位于 build 之后，不应因
 *   顺序问题误报。
 */

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const SOFT_BYTES = 256 * 1024
const HARD_BYTES = 500 * 1024

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const clientPath = resolve(repoRoot, 'lib', 'client.js')
const hostPath = resolve(repoRoot, 'lib', 'index.js')

if (!existsSync(clientPath)) {
  console.log('[bundle-size] skip：lib/client.js 不存在（先构建产物再跑体积守卫）')
  process.exit(0)
}

const clientBytes = statSync(clientPath).size
const kib = (bytes) => (bytes / 1024).toFixed(1)

console.log(`[bundle-size] lib/client.js = ${String(clientBytes)} 字节（${kib(clientBytes)} KiB）`)
if (existsSync(hostPath)) {
  const hostBytes = statSync(hostPath).size
  console.log(`[bundle-size] lib/index.js  = ${String(hostBytes)} 字节（${kib(hostBytes)} KiB，服务端半边，不设门禁）`)
}

if (clientBytes > HARD_BYTES) {
  console.error(`[bundle-size] 超强警告线 ${String(HARD_BYTES)} 字节（500 KiB）——应立刻着手压缩。`)
  console.error('           排查方向：未用 CSS、重复的 JSX 结构、客户端重复携带的模型目录 / 双语词典、')
  console.error('           过度内联的依赖。注意：本线是本仓自设成本线。')
  process.exit(1)
}

if (clientBytes > SOFT_BYTES) {
  console.log(`[bundle-size] 超历史软线 ${String(SOFT_BYTES)} 字节（256 KiB）——新增功能请同步评估体积成本`)
  console.log('           （文案 / CSS / 依赖 / 目录表都要入账），避免下次撞强线。')
  process.exit(0)
}

console.log(`[bundle-size] 客户端 bundle 在软线内（余量 ${String(SOFT_BYTES - clientBytes)} 字节到软线）`)
process.exit(0)
