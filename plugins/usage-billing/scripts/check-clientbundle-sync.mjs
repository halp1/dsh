#!/usr/bin/env node
/**
 * check-clientbundle-sync.mjs —— vendored clientBundle.ts 与宿主 monorepo
 * 工厂的平台种子漂移检测（E-8）。
 *
 * scripts/clientBundle.ts 的 PLATFORM_MODULES 注释声明「verbatim 拷贝自宿主
 * packages/client/web/src/platform.ts，宿主种子扩张须镜像」。此前没有校验：
 * 宿主升级加平台模块（如 0.2.1 新增 dsh-client-ui-dockkit）时，我们只能靠
 * 运行时炸了才发现种子落后。
 *
 * 行为：
 * - 定位宿主 monorepo：`--repo <path>` > `$DSH_HARNESS_REPO` > 兄弟目录
 *   `../deepseek-harness` > `~/deepseek-harness`。
 * - 找不到 monorepo：打 skip 提示退出 0（CI 无 monorepo checkout 时正常）。
 * - 找得到：抽取两侧 PLATFORM_MODULES 列表比对（顺序敏感——verbatim 语义），
 *   不一致打漂移报告退出 1；一致打印宿主 HEAD 佐证退出 0。
 *
 * watch-dsh-releases 每日任务会 shallow clone 宿主仓跑本脚本，漂移自动开
 * label=clientbundle-drift 的 issue。
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const repoArgIdx = args.indexOf('--repo')
const candidates = [
  repoArgIdx >= 0 ? args[repoArgIdx + 1] : undefined,
  process.env.DSH_HARNESS_REPO,
  resolve('..', 'deepseek-harness'),
  join(homedir(), 'deepseek-harness'),
].filter(Boolean)

const harnessRepo = candidates.find(path => existsSync(join(path, 'packages', 'client', 'web', 'src', 'platform.ts')))
if (harnessRepo === undefined) {
  console.log('[bundle-sync] skip：本地无宿主 monorepo（设 DSH_HARNESS_REPO 或 --repo 指向 deepseek-harness 克隆可启用）')
  process.exit(0)
}

/** 抽取源码里 `export const PLATFORM_MODULES = [ ... ] as const` 的字符串字面量列表。 */
function extractSeed(path, label) {
  if (!existsSync(path)) {
    console.error(`[bundle-sync] ${label} 文件缺失：${path}`)
    process.exit(1)
  }
  const text = readFileSync(path, 'utf8')
  const match = /PLATFORM_MODULES\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]/.exec(text)
  if (match === null) {
    console.error(`[bundle-sync] ${label} 里找不到 PLATFORM_MODULES 数组：${path}`)
    process.exit(1)
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1])
}

const upstream = extractSeed(
  join(harnessRepo, 'packages', 'client', 'web', 'src', 'platform.ts'),
  '宿主 platform.ts',
)
const ours = extractSeed('scripts/clientBundle.ts', '本仓 clientBundle.ts')

let head = 'unknown'
try {
  head = readFileSync(join(harnessRepo, '.git', 'HEAD'), 'utf8').trim()
} catch {
  // 非 git 克隆或浅克隆：HEAD 读不到不影响判定
}

const sameOrder = JSON.stringify(upstream) === JSON.stringify(ours)
const sameSet = upstream.length === ours.length && upstream.every(m => ours.includes(m)) && ours.every(m => upstream.includes(m))

if (sameOrder) {
  console.log(`[bundle-sync] 平台种子一致（${String(upstream.length)} 模块）；宿主 HEAD ${head}`)
  process.exit(0)
}

console.error('[bundle-sync] 平台种子漂移！scripts/clientBundle.ts 的 PLATFORM_MODULES 须镜像宿主 platform.ts：')
console.error(`  宿主（${String(upstream.length)}）: ${JSON.stringify(upstream)}`)
console.error(`  本仓（${String(ours.length)}）: ${JSON.stringify(ours)}`)
if (sameSet) console.error('  （集合相同、顺序不同——verbatim 语义要求顺序也一致）')
console.error(`  宿主 HEAD ${head}`)
process.exit(1)
