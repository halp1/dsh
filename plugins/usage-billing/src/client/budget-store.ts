/**
 * 预算偏好 store：本月预算的开关与金额。
 *
 * 用户在仪表盘里用开关控制预算条显隐、用数字输入框设置金额；状态经框架
 * store 引擎持久化到 localStorage（persist key 即存储身份），重启后保留。
 * 宿主 Config 的 monthlyBudget 仅作为金额未设置时的默认值，用户输入优先。
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** 预算偏好状态。 */
export interface BudgetPrefsState {
  /** 预算条开关：关 = 只显示标题行与开关，不显示进度。 */
  enabled: boolean
  /** 用户设置的月度预算（人民币元）；0 = 未设置（回退到宿主默认值）。 */
  amount: number
  /** 各档提醒的最后通知日期戳（档位百分比字符串 → YYYY-MM-DD）：每档每天最多一次。 */
  tierAlertDays: Record<string, string>
  /** 最近一次余额不足通知的日期戳（YYYY-MM-DD）：余额告警同样每天最多一次。 */
  lastBalanceAlertDay: string
  /** 最近一次峰谷切换提醒的切换点时刻（毫秒）：同一切换点只提醒一次。 */
  lastTierSwitchAt: number
  /** 按模型月度预算（模型目录键 → 人民币元/月；U-3）。缺键 = 该模型不限。 */
  modelBudgets: Record<string, number>
  /** 按模型预算提醒的最后通知日期戳（`${model}:${tier}` → YYYY-MM-DD）：每模型每档每天最多一次。 */
  modelTierAlertDays: Record<string, string>
}

/** 预算偏好的完整写面（组件只能经这些 action 写入）；type 别名以兼容 ActionsDecl 的索引签名约束。 */
export type BudgetPrefsActions = {
  setEnabled: (d: BudgetPrefsState, on: boolean) => void
  setAmount: (d: BudgetPrefsState, value: number) => void
  markTierAlerted: (d: BudgetPrefsState, tiers: readonly number[], day: string) => void
  markBalanceAlerted: (d: BudgetPrefsState, day: string) => void
  markTierSwitchAlerted: (d: BudgetPrefsState, at: number) => void
  setModelBudget: (d: BudgetPrefsState, key: string, value: number) => void
  markModelTierAlerted: (d: BudgetPrefsState, marks: readonly string[], day: string) => void
}

/** 读取兜底：v1.5.x 老持久化状态缺 `modelBudgets` 键（模块级常量，引用稳定不触发重渲染）。 */
export const EMPTY_MODEL_BUDGETS: Readonly<Record<string, number>> = {}
/** 读取兜底：v1.5.x 老持久化状态缺 `modelTierAlertDays` 键（同上）。 */
export const EMPTY_MODEL_TIER_ALERT_DAYS: Readonly<Record<string, string>> = {}

/**
 * Declare the budget-preferences store handle.
 * @returns the store handle for the register call's store seat.
 */
export function createBillingBudgetStore(): EngineStoreHandle<BudgetPrefsState, BudgetPrefsActions> {
  return defineStore({
    init: (): BudgetPrefsState => ({ enabled: false, amount: 0, tierAlertDays: {}, lastBalanceAlertDay: '', lastTierSwitchAt: 0, modelBudgets: {}, modelTierAlertDays: {} }),
    persist: 'dsh.ui-usage-billing.budget',
    actions: {
      setEnabled: (d, on) => { d.enabled = on },
      // 负数无意义，归零视为未设置（回退宿主默认值）。
      setAmount: (d, value) => { d.amount = Number.isFinite(value) && value > 0 ? value : 0 },
      // 一次把多个档位标记为当日已提醒（旧持久化状态可能缺该字段，就地补空表）。
      markTierAlerted: (d, tiers, day) => {
        d.tierAlertDays ??= {}
        for (const tier of tiers) d.tierAlertDays[String(tier)] = day
      },
      markBalanceAlerted: (d, day) => { d.lastBalanceAlertDay = day },
      markTierSwitchAlerted: (d, at) => { d.lastTierSwitchAt = at },
      // U-3 按模型预算：正数写入，0/负数/非有限值 = 移除该模型限额。
      setModelBudget: (d, key, value) => {
        d.modelBudgets ??= {}
        if (Number.isFinite(value) && value > 0) d.modelBudgets[key] = value
        else delete d.modelBudgets[key]
      },
      // U-3 一次把多个 `${model}:${tier}` 标记为当日已提醒（旧持久化缺字段就地补）。
      markModelTierAlerted: (d, marks, day) => {
        d.modelTierAlertDays ??= {}
        for (const mark of marks) d.modelTierAlertDays[mark] = day
      },
    },
  })
}
