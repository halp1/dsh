/**
 * Config 运行时导出契约（issue #98）：宿主 dsh-settings@0.2.1-rc.2 的写回链路
 * （settings.update → configEditor.entries → schema(entry)）要求插件运行时模块
 * 导出带 toJSON 的 `Config`，缺失时抛 `No configurable plugin entry`——「注入用量
 * 查询」开关整体失效（v1.6.0 拆分时退化成纯类型的回归，#80 方案被回退）。
 * 本文件锁住三件事：入口导出存在、volatile 元数据在 toJSON 里、非 strict 解析
 * 保留未声明键（statsPath / routeAliases 等既有配置不受影响）。
 */

import { describe, expect, it } from 'vitest'
import * as UsageBilling from '../src/index.ts'
import { Config } from '../src/config.ts'

describe('Config runtime export (issue #98)', () => {
  it('exports a schema with toJSON from the plugin entry module', () => {
    // 宿主 schema(entry) 的判定条件正是 `'toJSON' in schema`。
    expect(UsageBilling.Config).toBeDefined()
    expect(typeof UsageBilling.Config.toJSON).toBe('function')
    // 入口导出与 config.ts 定义是同一份（re-export 不丢失）。
    expect(UsageBilling.Config).toBe(Config)
  })

  it('declares enableUsageStatsTool with volatile meta in toJSON', () => {
    const desc = JSON.stringify(Config.toJSON())
    expect(desc).toContain('enableUsageStatsTool')
    // 宿主据此把字段投影为 volatile 引用：写入即时反映、settings.update 可写回。
    expect(desc).toContain('"volatile":true')
  })

  it('keeps undeclared config keys through the non-strict parse', () => {
    const parsed = Config({ enableUsageStatsTool: true, statsPath: '/tmp/x', routeAliases: { a: 'b' } }) as Record<string, unknown>
    // volatile 字段解析后就是宿主交给 apply 的引用形态（.get() 即时反映写入），
    // 而非普通布尔——readUsageStatsToggle 的双形态分支覆盖这一点。
    expect(typeof (parsed.enableUsageStatsTool as { get(): boolean }).get).toBe('function')
    expect((parsed.enableUsageStatsTool as { get(): boolean }).get()).toBe(true)
    // 未声明键原样保留（schemastery 非 strict merge）。
    expect(parsed.statsPath).toBe('/tmp/x')
    expect(parsed.routeAliases).toEqual({ a: 'b' })
  })

  it('defaults the toggle to false when absent', () => {
    const parsed = Config({}) as Record<string, unknown>
    expect((parsed.enableUsageStatsTool as { get(): boolean }).get()).toBe(false)
  })
})
