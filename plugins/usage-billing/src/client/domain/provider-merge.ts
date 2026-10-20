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

import type { SessionBillingRow } from './types.ts'

/**
 * 同标题会话合并：fork/resume 派生的多段会话共用同一标题但各自成行——同标题
 * 归并为一行作为一级（calls/cost 求和、lastActive 取 max、任一子行 stale 即
 * 组 stale），各段明细收进 children 默认收起、点击展开。无标题行保持独立。
 * 输入必须已排除子智能体行（它们按 parentId 归位，不参与标题归并——子会话与
 * 顶层会话撞标题时会错并）。费用倒序保持紧凑。
 */
export function mergeSessionRows(rows: readonly SessionBillingRow[]): SessionBillingRow[] {
  const merged = new Map<string, SessionBillingRow>()
  const out: SessionBillingRow[] = []
  for (const row of rows) {
    if (row.title === undefined || row.title === '') {
      out.push(row)
      continue
    }
    const hit = merged.get(row.title)
    if (hit === undefined) {
      const copy: SessionBillingRow = { ...row, mergedCount: 1 }
      merged.set(row.title, copy)
      out.push(copy)
      continue
    }
    // 首个成员的原始行收进 children（spread 在 children 赋值前，天然无嵌套；
    // 副本带 mergedCount:1 无碍——二级行渲染只读 id/项目/数值列）。
    if (hit.children === undefined) hit.children = [ { ...hit } ]
    hit.children.push({ ...row })
    hit.calls += row.calls
    hit.cost += row.cost
    hit.lastActive = Math.max(hit.lastActive, row.lastActive)
    // exactOptionalPropertyTypes：stale 只在为真时写入（undefined 不落 key）。
    if (row.stale === true) hit.stale = true
    hit.mergedCount = (hit.mergedCount ?? 1) + 1
  }
  return out.sort((a, b) => b.cost - a.cost || b.lastActive - a.lastActive)
}

/**
 * 会话明细的展示归组：先同标题合并顶层行（issue #42），再把子智能体行按父链
 * 挂树——一阶子行挂最近顶层组，二阶起挂到**直接委派方**的子行之下（issue #99
 * 方案 A：多级委派不再拍平，「哪次委派最贵」按链合计倒序一眼可读）。挂靠目标
 * 命中合并组的任一段即可；直接父不在本批（封顶/日志已删）时沿父链回退找最近
 * 顶层组，两处都落空则作为独立行并回顶层。
 */
export function buildSessionDisplay(rows: readonly SessionBillingRow[]): SessionBillingRow[] {
  // 父链解析索引：原始行 id → 行（含子行；挂靠只认顶层组，链上子会话不作为挂点）。
  const byId = new Map(rows.map(row => [row.id, row]))
  // 顶层同标题合并：子智能体行不参与（它们按父链归位）。
  const tops = mergeSessionRows(rows.filter(row => row.parentId === undefined))
  // 合并组成员 id → 组行：子行的父会话是组内任一段时都挂到组行上。
  const groupOf = new Map<string, SessionBillingRow>()
  for (const group of tops) {
    groupOf.set(group.id, group)
    for (const segment of group.children ?? []) groupOf.set(segment.id, group)
  }
  const attached = new Set<string>()
  // 展示父索引（id → 直接挂靠方的 id）：树形挂靠前的环检测用——异常数据的
  // 互指父子（a.parentId=b 且 b.parentId=a）若照直挂靠会造出渲染死循环。
  const displayParentOf = new Map<string, string>()
  const attachUnder = (parentRow: SessionBillingRow, row: SessionBillingRow): void => {
    if (parentRow.subs === undefined) parentRow.subs = [row]
    else parentRow.subs.push(row)
    attached.add(row.id)
    displayParentOf.set(row.id, parentRow.id)
  }
  for (const row of rows) {
    if (row.parentId === undefined) continue
    // 直接父是本批里的子行 → 挂成树（嵌套在其直接委派方之下）。挂前沿展示父链
    // 走一遍：若会走回自己（环）就放弃树挂，落回组挂/独立行。
    const direct = byId.get(row.parentId)
    if (direct !== undefined && direct.parentId !== undefined && direct.id !== row.id) {
      let ancestor: string | undefined = direct.id
      const walked = new Set<string>()
      let cyclic = false
      while (ancestor !== undefined && !walked.has(ancestor)) {
        walked.add(ancestor)
        if (ancestor === row.id) { cyclic = true; break }
        ancestor = displayParentOf.get(ancestor)
      }
      if (!cyclic) {
        attachUnder(direct, row)
        continue
      }
    }
    // 直接父不在本批（封顶/日志删）或父是顶层会话 → 沿父链找最近顶层组；环按
    // visited 跳过。挂靠的子行不再重复归位。
    const visited = new Set<string>()
    let current: string | undefined = row.parentId
    while (current !== undefined && !visited.has(current)) {
      visited.add(current)
      const anchor = groupOf.get(current)
      if (anchor !== undefined) {
        if (!attached.has(row.id)) attachUnder(anchor, row)
        break
      }
      current = byId.get(current)?.parentId
    }
  }
  // 组内子行按**链合计**倒序（本行费用 + 全部下级）：一阶委派谁最贵一眼可读；
  // 旧快照无 subCost 时退化为本行费用。递归应用到各层级。
  const chainCost = (row: SessionBillingRow): number => row.cost + (row.subCost ?? 0)
  const sortSubs = (row: SessionBillingRow): void => {
    row.subs?.sort((a, b) => chainCost(b) - chainCost(a) || b.lastActive - a.lastActive)
    for (const sub of row.subs ?? []) sortSubs(sub)
  }
  for (const group of tops) sortSubs(group)
  // 挂靠的子行按链合计已排；未挂上的独立子行并回顶层，与组行一起保持费用倒序。
  const orphans = rows.filter(row => row.parentId !== undefined && !attached.has(row.id))
  return [...tops, ...orphans].sort((a, b) => b.cost - a.cost || b.lastActive - a.lastActive)
}
