/**
 * Plugin configuration（v1.5.2 抽出）：UsageBillingConfig 原本声明在 src/index.ts
 * 顶部，src/index.ts 收缩为装配器后被 src/routes/usage-stats.ts 等路由文件
 * 引用（作为 Deps 类型签名），把它单独放这里让 route 文件能从 src/ 根 import。
 * 仍由 src/index.ts 的 apply(ctx, config) 消费：路由层只通过 Deps 拿到它，
 * 不直接构造。
 */

import type {
  CustomBalanceConfig,
  DeclaredEndpointConfig,
  SubscriptionPlanConfig,
} from './pricing-shared.ts'

/** 宿主 0.1.7+ 经 Config schema 解析后，volatile 字段在 config 中的稳定引用形态
 *  （cosmokit `Volatile<T>` 的最小结构镜像，避免为类型引入直接依赖）。 */
export interface VolatileToggle {
  /** @returns 当前生效的布尔快照（设置写入后原位更新，无需重载插件）。 */
  get(): boolean
}


/** Plugin configuration. */
export interface UsageBillingConfig {
  /** Absolute path to a `.dsh-usage-stats.json` fallback file. */
  statsPath?: string
  /** 统计快照的持久化路径；默认 `<harness home>/.dsh-usage-stats.json`
   *  （harness home = `DSH_HOME` 环境变量或 `~/.dsh`，见 resolveDshHome）。
   *  测试注入临时目录以隔离真实家目录（聚合失败回退与快照落盘都走此路径）。 */
  snapshotPath?: string
  /** 独立持久用量账本的绝对路径；默认 `<harness home>/.dsh-usage-ledger.json`。
   *  账本与会话日志解耦，因此永久删除会话不会抹掉已经观测到的用量。 */
  ledgerPath?: string
  /** 余额差对账基准的持久化路径；默认 `<harness home>/.dsh-usage-reconcile.json`。 */
  reconcilePath?: string
  /** 订阅制（coding / token / agent plan）provider id 列表；默认 kimi-coding、xiaomi-token-plan-cn。 */
  subscriptionProviders?: string[]
  /** 订阅套餐额度适配器（kimi / zai / opencode-go）；默认全部内置。 */
  subscriptionPlans?: readonly SubscriptionPlanConfig[]
  /** 余额查询用的 DeepSeek 凭据引用（环境变量名）；默认 DEEPSEEK_API_KEY。 */
  balanceApiKeyEnv?: string
  /** 月度预算（人民币元）；设置后随 usage-stats 下发，仪表盘显示预算进度条。 */
  monthlyBudget?: number
  /** 余额不足告警阈值（人民币元）：余额低于此值时仪表盘每天提醒一次；
      不设置则客户端按默认阈值（50 元）兜底。 */
  lowBalanceThreshold?: number
  /** 自定义 Provider 余额查询（任意 HTTP 端点 + extract 规则，适配 NewApi/LiteLLM 等）。 */
  customBalances?: readonly CustomBalanceConfig[]
  /**
   * 声明端点（declarative endpoints）：为内置表没有的供应商自声明余额/额度接口。
   * 绑定到某条已配置 provider 的同源地址，`fields` / `windows` 写响应里的取值路径；
   * 安全边界（origin 绑定、单斜杠 path、只 GET、跨源重定向失败、凭据取自 apiKeyEnv）
   * 写死在 declarative.ts。缺省空。
   */
  declaredEndpoints?: readonly DeclaredEndpointConfig[]
  /**
   * 允许通过 Host 头校验的额外主机名（反向代理场景）；缺省空，行为与历史版本完全一致。
   * 仅在 peer socket 已通过回环校验后才参考：socket 校验仍为强制且不受本字段影响，
   * 本名单只放宽「纵深防御」的第二层。匹配为**精确主机名**，忽略大小写与端口；
   * 不支持后缀 / 通配符，因此 `evil.com` 永远无法满足 `trusted.com`。
   * 例：`['llm.example.com']`。
   */
  trustedHosts?: string[]
  /** `usage_stats` 工具注入开关（默认 false：不注入）。宿主 0.1.7+ 经 Config
   *  解析后是 volatile 引用（设置写入即时反映），直连 apply（测试）是普通布尔；
   *  读取统一走 readUsageStatsToggle。该工具占用每次请求的上下文，coding 场景多在仪表盘查看。 */
  enableUsageStatsTool?: boolean | VolatileToggle
  /**
   * 联网搜索请求（`web/deepseek-search-llm-request`，日志只有请求、无用量事件）
   * 的单次费用估算（人民币元）。这类调用直连官方 api.deepseek.com，开放平台照常
   * 计费但本地日志无 usage，按次估值计入今日/本月费用；默认 0.02 元/次，设 0 关闭。
   */
  searchCallEstimateCny?: number
  /**
   * 历史路由别名（旧 provider 路由名 → 当前路由名）：改过名/删除过的路由，其
   * 历史用量原会落「未知路由」桶且站点/订阅/官方判定全部失效；配置别名后按
   * 目标路由归位。例：`{ "deepseek-official": "tencent", "tencent-cloud": "tencent" }`。
   */
  routeAliases?: Record<string, string>
  /**
   * 用户自定义模型别名（真实日志 model id → 计费目录键）：目录外的新模型无需
   * 等发版，配置一条别名即完成识别与计价（值必须是 MODEL_CATALOG 的既有 key，
   * 如 `{ "hy4-preview": "hunyuan" }`）。聚合折叠与客户端渲染共用同一映射。
   */
  modelKeyAliases?: Record<string, string>
}
