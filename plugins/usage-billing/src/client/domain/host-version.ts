/**
 * 双宿主版本兼容：宿主 0.1.7 起把 IconChevronDownOutline14 拆为 Regular/Medium/Artwork
 * 三个变体，旧名不再导出（issue #72：缺失名经宿主注入表解析为 undefined，渲染时
 * 抛 React #130 并被 sidebar.footer.action 槽位错误边界弹出）。bundle 对 primitives
 * 的 import 编译为运行时查表，缺失名不抛错，因此两个世代的名字都能同时引用：
 * 0.1.6 宿主只有旧名，0.1.7+ 宿主只有新名，按宿主世代取用。Medium 的默认 size 为 14，
 * 与旧组件渲染尺寸一致。导出名横跨两个宿主世代，单一类型版本无法同时声明，两个
 * 名字都按记录类型断言取用（图标无 props 渲染，本地结构类型即可）。
 *
 * 抽到这里避免 BillingDashboard 的 prop 拖一份图标解析；与 primitives import 一同
 * 隔离到独立文件，purify 走 tsdown 内联安全清单时更易管控。
 */

import type { ReactElement } from 'react'
import * as BillingPrimitives from '@deepseek-ai/dsh-client-ui-primitives'

type BillingIcon = () => ReactElement | null
const BillingChevronDownIcons = BillingPrimitives as unknown as Record<
  'IconChevronDownOutline14' | 'IconChevronDownOutlineMedium',
  BillingIcon | undefined
>

/** 运行时按宿主世代取用：0.1.7+ 走 Medium，旧名兜底。 */
export const BillingChevronDown: BillingIcon | undefined =
  BillingChevronDownIcons.IconChevronDownOutlineMedium ?? BillingChevronDownIcons.IconChevronDownOutline14
