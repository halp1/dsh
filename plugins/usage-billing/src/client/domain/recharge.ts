/**
 * 厂商官方充值页（issue #47）：账单 Tab 余额列「充值」外链的映射表。
 * key 为归一化 provider id（前缀匹配，`minimax-cn` 命中 `minimax`）；
 * 未收录厂商不渲染按钮（宁缺毋错链）。
 *
 * 多别名厂商共享的充值页常量（表内键去重引用，控制 bundle 体积）。
 */

import { normalizeProvider, providerNameHits, PROVIDER_ALIASES } from './provider-aliases.ts'

const URL_KIMI = 'https://platform.kimi.com/console/pay'
const URL_ZHIPU = 'https://open.bigmodel.cn/finance-center/finance/pay'
const URL_QWEN = 'https://bailian.console.aliyun.com/'
const URL_DOUBAO = 'https://console.volcengine.com/ark'
const URL_ANTHROPIC = 'https://console.anthropic.com/settings/billing'
const URL_GOOGLE = 'https://console.cloud.google.com/billing'
const URL_XAI = 'https://console.x.ai/'
const URL_XIAOMI = 'https://platform.xiaomimimo.com/console/balance'
const URL_TENCENT_RECHARGE = 'https://console.cloud.tencent.com/expense/recharge'

const RECHARGE_URLS: Readonly<Record<string, string>> = {
  deepseek: 'https://platform.deepseek.com/top_up',
  minimax: 'https://platform.minimax.cn/console/recharge-records',
  moonshot: URL_KIMI,
  kimi: URL_KIMI,
  zhipu: URL_ZHIPU,
  bigmodel: URL_ZHIPU,
  qwen: URL_QWEN,
  dashscope: URL_QWEN,
  doubao: URL_DOUBAO,
  volcengine: URL_DOUBAO,
  ark: URL_DOUBAO,
  openai: 'https://platform.openai.com/settings/organization/billing',
  anthropic: URL_ANTHROPIC,
  claude: URL_ANTHROPIC,
  google: URL_GOOGLE,
  gemini: URL_GOOGLE,
  xai: URL_XAI,
  grok: URL_XAI,
  siliconflow: 'https://cloud.siliconflow.cn/account/charge',
  hunyuan: URL_TENCENT_RECHARGE,
  tencent: URL_TENCENT_RECHARGE,
  /* 中文键：账单分组名是通道显示名（「腾讯云 Token Plan」「腾讯云 TokenHub」），
     归一化保留中文，靠前缀命中「腾讯云」映射到腾讯云充值中心。 */
  '腾讯云': URL_TENCENT_RECHARGE,
  xiaomi: URL_XIAOMI,
  mimo: URL_XIAOMI,
  /* 'mi' 必须排在 'minimax' 之后：前缀命中按键序遍历，'minimax-cn' 要先被
     'minimax' 摘走，不能落到更短的 'mi' 上。 */
  mi: URL_XIAOMI,
  qianfan: 'https://console.bce.baidu.com/qianfan/overview',
}

/** 归一化名 → 充值页 URL：先精确命中，再前缀命中。 */
function rechargeExactOrPrefix(key: string): string | undefined {
  const exact = RECHARGE_URLS[key]
  if (exact !== undefined) return exact
  const prefixHit = Object.keys(RECHARGE_URLS).find(k => key.startsWith(k))
  return prefixHit === undefined ? undefined : RECHARGE_URLS[prefixHit]
}

/**
 * 余额 provider → 官方充值页 URL。匹配顺序：归一化名精确/前缀命中 →
 * 经 PROVIDER_ALIASES 反查（余额 provider 名多为中文显示名，归一化仍是中文，
 * 需先命中 display 名再用其英文别名重试）。未收录返回 undefined。
 * 导出供测试：纯函数，不依赖组件。
 */
export function rechargeUrlOf(provider: string): string | undefined {
  const key = normalizeProvider(provider)
  const direct = rechargeExactOrPrefix(key)
  if (direct !== undefined) return direct
  for (const [display, aliases] of Object.entries(PROVIDER_ALIASES)) {
    if (!providerNameHits(normalizeProvider(display), key)) continue
    for (const alias of aliases) {
      const url = rechargeExactOrPrefix(normalizeProvider(alias))
      if (url !== undefined) return url
    }
  }
  return undefined
}
