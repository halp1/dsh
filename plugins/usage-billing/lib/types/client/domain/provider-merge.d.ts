/**
 * 会话明细展示归组（issue #42 + 子智能体归并 + #99 树形委派）：同标题合并顶层
 * 行，再把子智能体行按父链挂树——一阶子行挂最近存活的顶层组下，二阶起嵌套在
 * 直接委派方的子行之下（多级委派不再拍平），组内按链合计倒序。父行不在切片内
 * （服务端封顶或日志已删）的子行回退为独立行，仍带子智能体徽标，不丢数据。
 *
 * `mergeSessionRows` 是 issue #42 的核心：fork/resume 派生的多段会话共用同一
 * 标题但各自成行——同标题归并为一行作为一级（calls/cost 求和、lastActive 取 max、
 * 任一子行 stale 即组 stale），各段明细收进 children 默认收起、点击展开。
 */
import type { SessionBillingRow } from './types.ts';
/**
 * 同标题会话合并：fork/resume 派生的多段会话共用同一标题但各自成行——同标题
 * 归并为一行作为一级（calls/cost 求和、lastActive 取 max、任一子行 stale 即
 * 组 stale），各段明细收进 children 默认收起、点击展开。无标题行保持独立。
 * 输入必须已排除子智能体行（它们按 parentId 归位，不参与标题归并——子会话与
 * 顶层会话撞标题时会错并）。费用倒序保持紧凑。
 */
export declare function mergeSessionRows(rows: readonly SessionBillingRow[]): SessionBillingRow[];
/**
 * 会话明细的展示归组：先同标题合并顶层行（issue #42），再把子智能体行按父链
 * 挂树——一阶子行挂最近顶层组，二阶起挂到**直接委派方**的子行之下（issue #99
 * 方案 A：多级委派不再拍平，「哪次委派最贵」按链合计倒序一眼可读）。挂靠目标
 * 命中合并组的任一段即可；直接父不在本批（封顶/日志已删）时沿父链回退找最近
 * 顶层组，两处都落空则作为独立行并回顶层。
 */
export declare function buildSessionDisplay(rows: readonly SessionBillingRow[]): SessionBillingRow[];
//# sourceMappingURL=provider-merge.d.ts.map