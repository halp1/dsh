/**
 * Subscription-plan quota polling (node half): how much of each coding/token
 * plan is left. The billing dashboard already exempts subscription providers
 * from per-token cost; this module surfaces the REMAINING quota so the user
 * sees plan headroom instead of a blank row.
 *
 * The panel shows only the plans the user actually configured: adapters with
 * a known quota API (Kimi, Z.ai, OpenCode Go) query the remaining amount;
 * other subscription providers the harness recognizes (volcengine / baidu /
 * qwen / xiaomi token plans, agent plans…) are identified and listed with a
 * "no quota API" marker rather than hidden. API keys come from the `llm-pi-ai`
 * settings namespace resolved through the credentials seam: the classic
 * `apiKeyEnv` refs, or — on hosts whose settings UI stores route keys as
 * credentials refs named after the route (`<ROUTE>_API_KEY`, catalog ambient
 * names as fallback) — the conventional refs, matched against the same
 * subscription-class route ids.
 */
import type { SubscriptionPlanConfig, SubscriptionQuota, SubscriptionWindow } from './pricing-shared.ts';
/** 订阅适配器需要的凭据（来自 llm-pi-ai 设置命名空间）。 */
export interface SubscriptionKeys {
    /** Kimi For Coding API key。 */
    kimiApiKey: string;
    /** Z.ai Coding Plan API key（国际域 api.z.ai）。 */
    zaiApiKey: string;
    /** Z.ai（智谱国内域）Coding Plan API key——国内 / 国际是两个平台，key 不通用（不同于 MiniMax 的同 key 双域）。 */
    zaiCnApiKey: string;
    /** OpenCode Go API key。 */
    opencodeApiKey: string;
    /** MiniMax Token Plan API key。 */
    minmaxApiKey: string;
    /** OpenRouter API key（credits 已用%）。 */
    openrouterApiKey: string;
    /** Anthropic Claude Pro/Max OAuth access token。 */
    anthropicApiKey: string;
    /** CommandCode API key（user_* 前缀）。 */
    commandcodeApiKey: string;
    /** 腾讯云云 API 密钥对（`<SecretId>:<SecretKey>`，管控面用，非 TokenHub 推理 key）。 */
    tencentCloudApi: string;
    /** Z.ai 区域（global / bigmodel-cn）。 */
    zaiRegion: 'global' | 'bigmodel-cn';
}
/**
 * 解析 OpenCode 客户端凭据文档（~/.local/share/opencode/auth.json）里的
 * OpenCode Go token。两种形态都收：
 * - 平铺：`{"token": "..."}` / `{"key": "..."}` / `{"apiKey": "..."}` / 裸字符串；
 * - 按 provider 分桶（实测形态）：`{"opencode-go": {"type": "api", "key": "..."}}`，
 *   桶序 opencode-go → opencode → zen 即优先序。
 * 识别不出返回空串，绝不抛错——这只是一次便利回退。
 */
export declare function parseOpenCodeAuthDocument(document: unknown): string;
/** 空凭据：全部未配置时的初始值。 */
export declare const EMPTY_SUBSCRIPTION_KEYS: SubscriptionKeys;
/**
 * key 解析的可测核心（无文件 I/O）：先显式 `apiKeyEnv`（旧口径，优先），key 仍缺
 * 时按约定 ref 名解析（新版宿主的存放形态，见 route-keys.ts）。`keyConfigured`
 * 回报每条路由的 key 是否解析成功，供识别层作为第三配置信号（refResolved）。
 * @param providers - llm-pi-ai 的 providers 视图。
 * @param resolveRef - 凭据 seam：ref 名 → 非空 key 值；未配置/失败返回 undefined。
 */
export declare function resolveSubscriptionAccess(providers: Readonly<Record<string, SubscriptionRouteConfigView | undefined>>, resolveRef: (name: string) => Promise<string | undefined>): Promise<{
    keys: SubscriptionKeys;
    keyConfigured: ReadonlySet<string>;
}>;
/** 已识别的一个订阅套餐（用户在 llm-pi-ai 里配置了 key 的订阅类 provider）。 */
export interface IdentifiedSubscriptionPlan {
    /** llm-pi-ai 的 provider id（如 kimi-coding、xiaomi-token-plan-cn）。 */
    provider: string;
    /** 显示名（映射表命中则用映射，否则用 id）。 */
    displayName: string;
    /** 是否有额度查询适配器。 */
    adapter: boolean;
    /** 适配器区域覆盖：两个 Z.ai 路由各自固定区域，互不跟随 keys.zaiRegion。 */
    region?: 'global' | 'bigmodel-cn';
}
/**
 * 一条 llm-pi-ai 路由的订阅识别视图：三个「已配置」信号任一为真即识别。
 * 新版宿主（内置目录 + ambient 发现）把路由 key 存进凭据 refs，providers 配置里
 * 只剩 models 列表——`apiKeyEnv` 不再是唯一的配置信号。
 */
export interface SubscriptionRouteConfigView {
    /** 显式凭据引用（旧口径）。 */
    apiKeyEnv?: string;
    /** 路由声明了非空 models 列表（新版设置页保存的配置形态）。 */
    hasModels?: boolean;
    /** 路由约定 ref（`<ROUTE>_API_KEY` / 目录 ambient 名）解析出了非空 key。 */
    refResolved?: boolean;
}
/** 是否是订阅类 provider id（如 kimi-coding、xiaomi-token-plan-cn）。 */
export declare function isSubscriptionProviderId(providerId: string): boolean;
/**
 * 从 llm-pi-ai 设置里识别订阅套餐：带订阅类 id 且任一配置信号成立的 provider
 * （显式 apiKeyEnv / models 已配置 / 约定 ref 解析出了 key）。
 * @param providers - the `providers` map of the llm-pi-ai settings namespace.
 * @returns identified plans in configuration order.
 */
export declare function identifySubscriptionPlans(providers: Record<string, SubscriptionRouteConfigView | undefined> | undefined): IdentifiedSubscriptionPlan[];
/**
 * 解析 MiniMax Token Plan `/v1/token_plan/remains` 响应。取 general(或 MiniMax-M*)
 * 一行抽出 5h/7d 窗口(total_count 常为 0,以 remaining_percent 为准),不按模型拆条。
 * 导出供测试:纯函数。
 * @param body - 接口响应 JSON。
 * @returns 窗口列表;无可用窗口时为空数组。
 */
export declare function parseMiniMaxRemains(body: unknown): SubscriptionWindow[];
/** MiniMax Token Plan / Coding Plan 的 key 判别：普通按量 API key 以 `sk-` 开头，
 *  Token Plan（订阅套餐）key 以 `sk-cp-` 开头。据此区分一个 key 是订阅还是按量，
 *  供查询失败时给出「key 类型 / region」定向提示，避免把按量 key 误当 token-plan
 *  查询后只剩一句笼统的「响应异常」；也是聚合层订阅豁免的判定依据（同一路由 id
 *  按量/套餐两用，豁免只能按 key）。 */
export declare function isMiniMaxTokenPlanKey(apiKey: string): boolean;
/** MiniMax 系路由 id（官方目录 minimax / minimax-cn 与本插件早期命名 minimax-token-plan[-cn]）。 */
export declare function isMiniMaxProviderId(providerId: string): boolean;
/**
 * 逐路由判定 MiniMax 系路由是否 Coding Plan：按该路由自己的 key（显式 apiKeyEnv
 * 优先，缺省按路由约定 ref）解析后看 `sk-cp-` 前缀。同一路由 id（如官方目录的
 * minimax-cn）按量用户与套餐用户两用，订阅豁免不能按路由 id 一刀切——此前聚合
 * 层默认集合干脆不含 minimax，套餐用户的用量被无条件按量计费。解析不出 key
 * 的路由判为 false（保守：不豁免）。导出供测试：无文件 I/O。
 * @param providers - llm-pi-ai providers 视图。
 * @param resolveRef - 凭据 seam：ref 名 → 非空 key 值。
 * @returns MiniMax 系路由 id → 是否 Coding Plan。
 */
export declare function classifyMiniMaxPlanRoutes(providers: Readonly<Record<string, SubscriptionRouteConfigView | undefined>>, resolveRef: (name: string) => Promise<string | undefined>): Promise<ReadonlyMap<string, boolean>>;
/**
 * 解析 OpenRouter `/api/v1/credits` 响应:已用% = total_usage / total_credits。
 * 导出供测试:纯函数。
 * @param body - 接口响应 JSON。
 * @returns 窗口列表;无有效额度时为 []。
 */
export declare function parseOpenRouterCredits(body: unknown): SubscriptionWindow[];
/**
 * 解析 Anthropic OAuth 用量响应（GET https://api.anthropic.com/api/oauth/usage）。
 * 形如 `{ five_hour: { utilization, resets_at }, seven_day: {...}, seven_day_sonnet: {...} }`：
 * `utilization` 为 0–100 百分数，`resets_at` 为 unix 秒。子配额窗口
 * （`seven_day_sonnet` / `five_hour_opus` 等单模型系列限额）只描述一个模型分支，
 * 与主窗口量纲相同但口径更窄，整体丢弃，避免面板百分比被分支配额覆盖。
 * 导出供测试：纯函数。
 * @param body - 接口响应 JSON。
 * @returns 窗口列表（5 小时 → session、7 天 → weekly）；无可用窗口时为 []。
 */
export declare function parseAnthropicUsage(body: unknown): SubscriptionWindow[];
/**
 * 解析 CommandCode（commandcode.ai）额度响应
 * （GET https://api.commandcode.ai/alpha/billing/credits）。形如
 * `{ windowLimits: { fiveHour: { used, cap, resetAt }, weekly: {...} }, credits: { monthlyCredits } }`：
 * 窗口按 used/cap 算已用%（resetAt 为 epoch 毫秒）；monthlyCredits 是月度
 * Credits 余额池（1 credit ≈ $1 用量），无总量字段、算不出百分比，不产出窗口。
 * 导出供测试：纯函数。
 * @param body - 接口响应 JSON。
 * @returns 窗口列表（5 小时 → session、周 → weekly）；无可用窗口时为 []。
 */
export declare function parseCommandCodeCredits(body: unknown): SubscriptionWindow[];
/**
 * Collect quota for the given plans concurrently (adapter-backed plans only;
 * identified plans without an adapter are surfaced by the caller as "no
 * quota API" rows).
 * @param keys - the API keys from the llm-pi-ai settings namespace.
 * @param plans - adapter-backed plans to poll; empty by default.
 * @param timeoutMs - per-request timeout; defaults to 15s.
 * @returns the quotas in plan order (unknown providers degrade to `unavailable`).
 */
export declare function collectSubscriptions(keys: SubscriptionKeys, plans?: readonly SubscriptionPlanConfig[], timeoutMs?: number): Promise<readonly SubscriptionQuota[]>;
//# sourceMappingURL=subscriptions.d.ts.map