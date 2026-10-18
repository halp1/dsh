/**
 * 会话明细展示归组（issue #42 + 子智能体归并）：同标题合并顶层行，再把子智能体
 * 行（parentId 指向父会话）挂到最近存活的顶层组下（多级委派沿父链拍平到根
 * 对话），挂靠目标命中合并组的任一段即可。父行不在切片内（服务端封顶或日志
 * 已删）的子行回退为独立行，仍带子智能体徽标，不丢数据。
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
 * 会话明细的展示归组：先同标题合并顶层行（issue #42），再把子智能体行
 * （parentId 指向父会话）挂到最近存活的顶层组下（多级委派沿父链拍平到根
 * 对话），挂靠目标命中合并组的任一段即可。
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
  // 子行挂靠：沿 parentId 找最近存活顶层组；visited 防异常数据的环。
  const attached = new Set<string>()
  for (const row of rows) {
    if (row.parentId === undefined) continue
    const visited = new Set<string>()
    let current: string | undefined = row.parentId
    while (current !== undefined && !visited.has(current)) {
      visited.add(current)
      const anchor = groupOf.get(current)
      if (anchor !== undefined) {
        if (anchor.subs === undefined) anchor.subs = [row]
        else anchor.subs.push(row)
        attached.add(row.id)
        break
      }
      current = byId.get(current)?.parentId
    }
  }
  // 挂靠的子行按最后活跃倒序（组内时序直观）；未挂上的独立子行并回顶层，
  // 与组行一起保持费用倒序。
  for (const group of tops) group.subs?.sort((a, b) => b.lastActive - a.lastActive)
  const orphans = rows.filter(row => row.parentId !== undefined && !attached.has(row.id))
  return [...tops, ...orphans].sort((a, b) => b.cost - a.cost || b.lastActive - a.lastActive)
}
