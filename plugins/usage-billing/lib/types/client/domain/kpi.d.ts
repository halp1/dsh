/**
 * 渲染层纯函数：健康点、订阅状态文本、订阅窗口标签、中转站程序类型、厂商组
 * 费用合计、子智能体后代合计、本地时钟。这些函数都返回字符串/数字/CSS
 * className，依赖 CSS module 提供的样式——抽到独立文件后 import 仍走
 * `UsageBilling.module.css`。
 */
import type { ModelHealth, ModelRow, ProviderBillingGroup, RelayQuota, SessionBillingRow, SubscriptionQuota } from './types.ts';
import type { UsageBillingKey } from '../locales.ts';
/** Resolve one provider's dot state: green when live, red when failed, gray when unknown. */
export declare function providerDot(health: ModelHealth, provider: string): string | undefined;
/** 订阅额度查询状态的文案（ok 时无需额外标注，返回空串）。 */
export declare function subscriptionStatusText(status: SubscriptionQuota['status'], t: (key: UsageBillingKey) => string): string;
/** 订阅额度窗口的类型标签（本次 / 本周 / 本月 / 计费周期）。 */
export declare function subscriptionWindowLabel(kind: SubscriptionQuota['windows'][number]['kind'], t: (key: UsageBillingKey) => string): string;
/** 中转站程序类型的徽标文案（New API / Sub2API / 未识别）。 */
export declare function relayKindText(kind: RelayQuota['kind'], t: (key: UsageBillingKey) => string): string;
/** 中转站程序类型对应的样式类（复用站点类别配色）。 */
export declare const RELAY_KIND_CLASS: Record<RelayQuota['kind'], string | undefined>;
/**
 * 厂商组费用合计（实际优先；订阅豁免行不计入）——付费者视角的一级信息（issue #34）。
 * 订阅豁免行无 actual，其 estimated 是「按量等价」而非支出：计入组头会渲染出
 * 「已豁免还要花钱」的误导（issue #37 的 grok 组头部 ¥383.6），预估语义保留在
 * 模型行的订阅卡（「套餐内预估开销」）。
 */
export declare const providerCostOf: (group: ProviderBillingGroup) => number;
/** 组行（单行或同标题合并组）的后代子智能体合计：合并组对成员段的 subCost/subCalls 求和。 */
export declare function subFamilyOf(row: SessionBillingRow): {
    cost: number;
    calls: number;
};
export type { ModelRow };
/** 本地时钟 `HH:MM:SS`：本仓时区展示用。 */
export declare function formatClock(time: number): string;
//# sourceMappingURL=kpi.d.ts.map