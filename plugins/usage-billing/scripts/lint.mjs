#!/usr/bin/env node
/**
 * lint.mjs —— 本仓纪律守卫（E-5 + S-5）。
 *
 * 本仓没引 ESLint/Prettier：650+ 用例与 0 错 tsc 已是主防线，此刻引入全量
 * linter 会带来整仓 reformat 噪音，收益不配代价。这里只守**已确立的纪律**，
 * 防回归而非挑新刺：
 *
 * 1. 类型纪律：`as any` / `: any` / `@ts-ignore` / `@ts-expect-error` 零容忍
 *    （2026-10 审计基线：全仓 0 个；任何新增都该走 `as unknown as` 收窄）。
 * 2. 日志纪律：src/ 禁 `console.log`——本仓门面是 `[usage-billing]` 前缀的
 *    info/warn/error，log 会绕过宿主日志过滤习惯。
 * 3. 可观察性纪律：空 catch 必须带注释——83 处 `catch {}` 多数是有意的
 *    「缺失=未配置」语义，但每一处都得说清为什么静默；真空 catch（连注释
 *    都没有）一律打回。
 * 4. CSS↔TSX 类名 parity（S-5）：import UsageBilling.module.css 的文件里
 *    `css.X` 引用必须在 .module.css 有 `.X` 定义——类名哈希在模块内解析，
 *    缺定义不报错只静默无效（v1.5.2 清出 8 个历史死引用）。
 *
 * 全绿退出 0；违规打印 文件:行 退出 1。CI 与 `pnpm lint` 共用本脚本。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = relative('.', fileURLToPath(new URL('.', import.meta.url)))
const SCAN_DIRS = ['src', 'tests']
const EXTS = new Set(['.ts', '.tsx'])
const VIOLATIONS = []

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) yield* walk(path)
    else if (EXTS.has(name.slice(name.lastIndexOf('.')))) yield path
  }
}

/** 提取匹配大括号块的 body（含注释原文）。 */
function braceBlock(text, openEnd) {
  let depth = 1
  let i = openEnd
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') depth -= 1
    i += 1
  }
  return text.slice(openEnd, i - 1)
}

for (const dir of SCAN_DIRS) {
  for (const path of walk(dir)) {
    const rel = relative(ROOT, path) || path
    const text = readFileSync(path, 'utf8')
    const lines = text.split('\n')

    // 守卫 1：类型纪律（逐行，模式精确避免评论误报由人工复核兜底）
    const typePatterns = [
      { re: /\bas any\b/, label: '`as any`' },
      { re: /:\s*any\b/, label: '`: any`' },
      { re: /@ts-ignore/, label: '`@ts-ignore`' },
      { re: /@ts-expect-error/, label: '`@ts-expect-error`' },
    ]
    for (const [index, line] of lines.entries()) {
      for (const { re, label } of typePatterns) {
        if (re.test(line)) VIOLATIONS.push(`${rel}:${index + 1}  类型纪律：${label}（走 as unknown as 收窄或修类型）`)
      }
    }

    // 守卫 2：src/ 禁 console.log
    if (dir === 'src') {
      for (const [index, line] of lines.entries()) {
        if (/console\.log\(/.test(line)) VIOLATIONS.push(`${rel}:${index + 1}  日志纪律：console.log（用 console.info/warn/error 带 [usage-billing] 门面）`)
      }
    }

    // 守卫 3：真空 catch（body 无任何内容——注释都没有）
    const catchRe = /catch\s*(?:\(\s*\w*\s*\))?\s*\{/g
    let match
    while ((match = catchRe.exec(text)) !== null) {
      const body = braceBlock(text, match.index + match[0].length)
      const withoutComments = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()
      if (withoutComments === '' && !body.includes('//') && !body.includes('/*')) {
        const line = text.slice(0, match.index).split('\n').length
        VIOLATIONS.push(`${rel}:${line}  可观察性：真空 catch 无注释（说明为什么静默，或改成 warn）`)
      }
    }
  }
}

// 守卫 4（S-5）：CSS↔TSX 类名 parity——UsageBilling.module.css 的消费方里
// `css.X` 引用必须在模块里有 `.X` 定义（缺失 = 静默无效样式，历史上积累过
// 8 个死引用）。CSS 独有类（供内部后代选择器用）不在此列，仅提示计数。
{
  const cssText = readFileSync(join('src', 'client', 'UsageBilling.module.css'), 'utf8')
  const defined = new Set([...cssText.matchAll(/\.([A-Za-z][A-Za-z0-9]*)/g)].map(m => m[1]))
  const used = new Map()
  for (const path of walk('src/client')) {
    const text = readFileSync(path, 'utf8')
    if (!text.includes('UsageBilling.module.css')) continue
    const rel = relative('.', path)
    for (const [index, line] of text.split('\n').entries()) {
      for (const m of line.matchAll(/css\.([A-Za-z][A-Za-z0-9]*)/g)) {
        if (!used.has(m[1])) used.set(m[1], `${rel}:${index + 1}`)
      }
    }
  }
  for (const [name, firstUse] of used) {
    if (!defined.has(name)) VIOLATIONS.push(`${firstUse}  CSS parity：css.${name} 在 UsageBilling.module.css 无定义（删引用或补样式）`)
  }
  console.log(`[lint] CSS parity：${String(used.size)} 个 TSX 引用类全部有定义（CSS 独有 ${String(defined.size - used.size)} 个供内部选择器）`)
}

// 守卫 5（#100）：CSS 自定义属性引用/定义 parity——模块样式里 var(--x) 引用的
// 令牌必须在文件内有定义，或属于宿主运行时提供的 --dsw-* 别名族。缺失令牌使
// var() 替换失败、属性退化为继承/初始值：--font-num 缺失让 Windows 中文区所有
// 数字渲染成宋体/Times（macOS 默认无衬线，验收不可见）；--dsb-1 笔误让币种按钮
// 选中态背景静默变透明。两起同源，故此守卫按引用侧收口。
{
  const cssText = readFileSync(join('src', 'client', 'UsageBilling.module.css'), 'utf8')
  // 剥掉注释再扫：修复说明里常会引用问题令牌的旧写法，注释不应触发违规。
  const cssCode = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  const defined = new Set([...cssCode.matchAll(/(--[A-Za-z][A-Za-z0-9-]*)\s*:/g)].map(m => m[1]))
  const hostProvided = (name) => name.startsWith('--dsw-')
  const referenced = new Map()
  for (const [index, line] of cssCode.split('\n').entries()) {
    for (const m of line.matchAll(/var\((--[A-Za-z][A-Za-z0-9-]*)/g)) {
      if (!referenced.has(m[1])) referenced.set(m[1], `src/client/UsageBilling.module.css:${index + 1}`)
    }
  }
  for (const [name, firstUse] of referenced) {
    if (!defined.has(name) && !hostProvided(name)) {
      VIOLATIONS.push(`${firstUse}  CSS parity：var(${name}) 引用的令牌无定义且非宿主 --dsw-* 别名（补定义或改用既有令牌）`)
    }
  }
  const own = [...referenced.keys()].filter(name => defined.has(name)).length
  console.log(`[lint] 令牌 parity：${String(referenced.size)} 个 var() 引用全部可解析（自有 ${String(own)} + 宿主 ${String(referenced.size - own)}）`)
}

if (VIOLATIONS.length > 0) {
  console.error(`[lint] ${VIOLATIONS.length} 项纪律违规：`)
  for (const v of VIOLATIONS) console.error(`  ${v}`)
  process.exit(1)
}
console.log('[lint] 纪律守卫全绿（类型 / 日志 / 空 catch 注释 / CSS parity / 令牌 parity）')
