/**
 * 设置页全文搜索（U-4）：按关键词过滤设置分区。
 *
 * 每个分区带一组中英文关键词（覆盖其标题、说明与常见同义词），查询串对
 * 关键词做大小写不敏感的子串匹配——任意关键词命中即显示该分区。查询为空
 * （或纯空白）时全部分区显示。
 *
 * 纯函数，导出供测试。
 */

/** 一个设置分区的隐藏判定：查询非空且没有任何关键词命中时隐藏。 */
export function settingsSectionHidden(query: string, keywords: readonly string[]): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return false
  return !keywords.some(keyword => keyword.toLowerCase().includes(q))
}
