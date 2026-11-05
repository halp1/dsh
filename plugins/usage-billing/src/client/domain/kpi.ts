/**
 * 渲染层纯函数：健康点、订阅状态文本、订阅窗口标签、中转站程序类型、厂商组
 * 费用合计、子智能体后代合计、本地时钟。这些函数都返回字符串/数字/CSS
 * className，依赖 CSS module 提供的样式——抽到独立文件后 import 仍走
 * `UsageBilling.module.css`。
 */

import css from '../UsageBilling.module.css'
import { providerMatches } from './provider-aliases.ts'
import type { ModelHealth, ModelRow, ProviderBillingGroup, RelayQuota, SessionBillingRow, SubscriptionQuota } from './types.ts'
import type { UsageBillingKey } from '../locales.ts'

/** Resolve one provider's dot state: green when live, red when failed, gray when unknown. */
export function providerDot(health: ModelHealth, provider: string): string | undefined {
  if (!health.checked) return css.healthIdle
  if (health.okProviders.some(live => providerMatches(provider, live))) return css.healthOk
  if (health.badProviders.some(live => providerMatches(provider, live))) return css.healthBad
  return css.healthIdle
}

/** 订阅额度查询状态的文案（ok 时无需额外标注，返回空串）。 */
export function subscriptionStatusText(status: SubscriptionQuota['status'], t: (key: UsageBillingKey) => string): string {
  switch (status) {
    case 'ok': return ''
    case 'not-configured': return t('subscriptionNotConfigured')
    case 'unauthorized': return t('subscriptionUnauthorized')
    case 'rate-limited': return t('subscriptionRateLimited')
    case 'invalid-response': return t('subscriptionInvalid')
    default: return t('subscriptionUnavailable')
  }
}

/** 订阅额度窗口的类型标签（本次 / 本周 / 本月 / 计费周期）。 */
export function subscriptionWindowLabel(kind: SubscriptionQuota['windows'][number]['kind'], t: (key: UsageBillingKey) => string): string {
  switch (kind) {
    case 'session': return t('subscriptionSession')
    case 'weekly': return t('subscriptionWeekly')
    case 'monthly': return t('subscriptionMonthly')
    case 'billing': return t('subscriptionBilling')
  }
}

/** 中转站程序类型的徽标文案（New API / Sub2API / 未识别）。 */
export function relayKindText(kind: RelayQuota['kind'], t: (key: UsageBillingKey) => string): string {
  switch (kind) {
    case 'new-api': return t('relayKindNewApi')
    case 'sub2api': return t('relayKindSub2Api')
    default: return t('relayKindUnknown')
  }
}

/** 中转站程序类型对应的样式类（复用站点类别配色）。 */
export const RELAY_KIND_CLASS: Record<RelayQuota['kind'], string | undefined> = {
  'new-api': css.siteKindSite,
  sub2api: css.siteKindDirect,
  unknown: css.siteKindUnknown,
}

/**
 * 厂商组费用合计（实际优先；订阅豁免行不计入）——付费者视角的一级信息（issue #34）。
 * 订阅豁免行无 actual，其 estimated 是「按量等价」而非支出：计入组头会渲染出
 * 「已豁免还要花钱」的误导（issue #37 的 grok 组头部 ¥383.6），预估语义保留在
 * 模型行的订阅卡（「套餐内预估开销」）。
 */
export const providerCostOf = (group: ProviderBillingGroup): number =>
  group.models.reduce((sum, m) => sum + (m.actual ?? (m.plan === true ? 0 : m.estimated)), 0)

/** 组行（单行或同标题合并组）的后代子智能体合计：合并组对成员段的 subCost/subCalls 求和。 */
export function subFamilyOf(row: SessionBillingRow): { cost: number; calls: number } {
  if (row.children !== undefined) {
    return (row.children ?? []).reduce(
      (acc, segment) => ({ cost: acc.cost + (segment.subCost ?? 0), calls: acc.calls + (segment.subCalls ?? 0) }),
      { cost: 0, calls: 0 },
    )
  }
  return { cost: row.subCost ?? 0, calls: row.subCalls ?? 0 }
}

// Re-export ModelRow for the 1 caller that imports it from the legacy UsageBilling path
// (avoid pulling additional files just to satisfy tsc). Phase 2 will move it back.
export type { ModelRow }
/** 本地时钟 `HH:MM:SS`：本仓时区展示用。 */
export function formatClock(time: number): string {
  const date = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
