/**
 * Usage billing surface plugin, node half.
 *
 * Serves `/api/billing/usage-stats`: real usage aggregated from every
 * persisted session log (see `aggregate.ts`) — the browser dashboard reads it
 * instead of showing an empty snapshot. Aggregation is stale-while-revalidate:
 * requests get a short wait budget and fall back to the freshest persisted
 * snapshot while a slow full fold keeps running in the background (a heavy
 * user's first fold takes minutes and must not starve the single-process
 * host's RPC). When `sessionPersistence` is unavailable (or aggregation
 * fails), the configured `statsPath` / `DSH_USAGE_STATS` / conventional JSON
 * file is served as a fallback, and a missing file answers `{ error }` so the
 * dashboard shows zeros, never fabricated samples.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { type UsageLedgerStore, type UsagePersistence } from './aggregate.ts';
import type { UsageBillingConfig } from './config.ts';
import { type IdentifiedSubscriptionPlan, type SubscriptionKeys } from './subscriptions.ts';
export { guardLoopback, isLoopbackOrigin, isLoopbackHost, isLoopbackPeer, hostNameOf, normalizeTrustedHosts } from './guard.ts';
/** 设置服务的读取面：两代宿主运行时都提供 describe（条目键为 profile entry id）。 */
interface SettingsReader {
    describe(options?: {
        redactSecrets?: boolean;
    }): readonly {
        ns: string;
        value: unknown;
    }[];
}
export type { UsageBillingConfig } from './config.ts';
/**
 * Create the atomic file-backed durable-ledger store. The previous complete file
 * is retained as `.bak`; a malformed/missing main file falls back to that backup.
 */
export declare function createFileUsageLedgerStore(ledgerPath: string): UsageLedgerStore;
/** Required services: the web server, the persisted session log store, and user settings. */
export declare const inject: string[];
/**
 * 读取 llm-pi-ai 设置的 `providers` 字典（`<route> → { apiKeyEnv? }`）。
 * 余额查询复用同一份来源：部署为某个 provider 配一次 key，多个 surface 共享。
 * @param settings - the settings service (reads the llm-pi-ai namespace).
 * @returns the providers dict; empty when the namespace is unreadable.
 */
/** 一个 llm-pi-ai provider 路由的读取视图：apiKeyEnv（凭据引用）、baseURL（中转站
 *  零配置发现）、displayName（站点显示名）、hasModels（新版宿主设置页保存的
 *  models 列表——订阅识别的第二配置信号）。 */
export interface PiAiProviderRoute {
    apiKeyEnv?: string;
    baseURL?: string;
    displayName?: string;
    hasModels?: boolean;
}
/** 同步读取 provider 路由的 baseURL 视图（中转站零配置发现来源）。
 *  `settings.describe` 是同步调用，聚合器每次折叠取最新站点映射，无需缓存/过期。
 *  注意：返回**全部可读路由**（baseURL 可选），聚合层据此区分「路由存在但无
 *  baseURL=直连」与「路由已删除=未知路由」两种不同归属。
 * @param settings - the settings service (reads the llm-pi-ai namespace).
 * @returns `<route> → { baseURL? }`；命名空间不可读时返回空。
 */
export declare function readPiAiProviderRoutes(settings: SettingsReader): Readonly<Record<string, {
    baseURL?: string;
}>>;
/**
 * 读取宿主 llm 注册表里「已注册 adapter」的 provider id（issue #91）。
 *
 * 必须经 `ctx.get('llm')`，**不能**用属性访问 `ctx.llm`：cordis 的服务代理要求
 * 服务名出现在插件 `inject` 里，否则抛 `cannot get property "llm" without inject`
 * ——1.4.31 把这个异常吞掉后退化成空集合，结果是「修复发版了但完全不生效」且无任何
 * 可观察信号（issue #91 follow-up）。本函数把「读不到」与「读到了空集合」都显式
 * 回报给调用方，让上层能告警而不是静默降级。
 * @param get - 宿主上下文的 `get(name)` 访问器（cordis 的免 inject 读取口）。
 * @returns `ids` = 已注册 provider id 集合（读不到时为空集）；
 *  `reason` = 读取失败或结果不可用的原因；成功时缺省。
 */
export declare function readRegisteredProviderIds(get: ((name: string) => unknown) | undefined): {
    ids: ReadonlySet<string>;
    reason?: string;
};
/**
 * 解析订阅适配器需要的 API Key：经典形态从 llm-pi-ai 设置的 `providers.<id>.apiKeyEnv`
 * 读引用（如 kimi-coding → KIMI_CODING_API_KEY）；新版宿主设置页把 key 直接存成
 * 凭据 refs（路由约定名 `<ROUTE>_API_KEY`，pi-ai 目录 ambient 名补充），显式引用
 * 解析不到时按约定名找回。同时识别出已配置的订阅套餐（供面板只显示已识别的）。
 * @param settings - the settings service (reads the llm-pi-ai namespace).
 * @param credentials - the credentials service (resolves the env refs).
 */
export declare function resolveSubscriptionKeys(settings: SettingsReader, credentials: CredentialProvider): Promise<{
    keys: SubscriptionKeys;
    identified: IdentifiedSubscriptionPlan[];
}>;
/**
 * 宿主 persistence 形状适配。宿主 0.1.3 起 SessionPersistence 改为
 * SessionHandle 模型（open(id,'read') 后经 handle.read(offset) 读，fork 边界
 * 挂在 handle.inheritedEventCount，list 返回 {header, revision} 快照行，
 * 0.1.2 的 readFrom/locate 消失；handle.read 自 0.1.3-alpha.2 起返回
 * {eventState, events} 包装）。这里按结构探测把两种宿主形状都收敛为
 * 聚合层期望的 0.1.2 面貌：0.1.2 直接带 readFrom 的原样直通；0.1.3 的
 * 读取转为 open → handle.read，revision 令牌经 stampOf 暴露给增量缓存。
 * 候选时刻的运行时对象是宿主注入的外部形状，结构断言即 durable 收窄点。
 * 导出供测试：纯函数（不触 ctx）。
 */
export declare function adaptSessionPersistence(raw: unknown): UsagePersistence;
/**
 * Host plugin body: serve real aggregated usage to the browser dashboard.
 * @param ctx - host context carrying webServer and sessionPersistence.
 * @param config - optional statsPath override.
 */
export declare function apply(ctx: Context, config?: UsageBillingConfig): void;
//# sourceMappingURL=index.d.ts.map