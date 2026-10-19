/**
 * 路由：GET/POST /api/billing/usage-tool
 *
 * usage_stats 工具开关：插件自带的读/写接口（不依赖宿主浏览器设置白名单）。
 * GET 返回当前是否注入；POST 写设置命名空间（重启应用后工具注入随新值生效）。
 * 写回失败回 503 + 宿主错误文案（issue #98：此前 200 + 笼统 invalid，开关无声
 * 弹回且无任何诊断线索）；body 非 JSON 回 400。
 *
 * 双世代宿主（issue #19 + #28 + v1.4.19）的接线在装配器里完成：
 * - 旧宿主 ≤0.1.6 走 `settings.register` 命名空间 scope。
 * - 宿主 0.1.7+ 注册面已移除，走 volatile config 投影。
 * 装配器提供 `read` / `write` 闭包，路由文件不感知双世代——`read()` 已内部分支
 * （scope 存在时读 scope，否则读 volatile + config base），`write(next)` 同理。
 * 工具注入由装配器的 `syncUsageTool` 驱动：写回后路由通过 `syncTool()` 显式调用一次
 * （幂等），覆盖「写回成功但引用未即时可见」的组合（测试替身不提交）。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 路由依赖。 */
export interface UsageToolDeps {
    trustedHosts: ReadonlySet<string>;
    /** 当前 enableUsageStatsTool 值（装配器内已做双世代分支）。 */
    read: () => boolean;
    /** 写回 + 立即同步工具注册（幂等）。 */
    write: (next: boolean) => Promise<void>;
    /** 写回后显式调用一次的工具注册同步（幂等）。 */
    syncTool: () => void;
}
export declare function registerUsageToolRoute(ctx: Context, deps: UsageToolDeps): void;
//# sourceMappingURL=usage-tool.d.ts.map