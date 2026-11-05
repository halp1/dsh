/**
 * 宿主 llm-pi-ai 新代际的路由 key 约定（订阅额度 / 余额 / 中转站 / 声明端点共用）。
 *
 * 新版宿主设置页把路由 key 直接存成凭据 refs（命名 = 路由 id 大写下划线 +
 * `_API_KEY`），providers 配置里只剩 models 列表；chat 认证走 pi-ai 目录路由的
 * ambient 发现，不再需要显式 `apiKeyEnv`。插件侧所有「按路由取 key」的读取口
 * 共用本模块的候选名推导与顺序解析——显式引用优先，约定名补后。
 */

/** 候选 ref 名：路由 id 约定名（`<ROUTE 大写下划线>_API_KEY`）优先，其后补宿主
 *  pi-ai 目录的 ambient env 名（仅当与约定名不同——目录把 kimi-coding 指到
 *  KIMI_API_KEY、opencode-go 与 opencode 同用 OPENCODE_API_KEY）。 */
export function routeKeyRefCandidates(route: string): readonly string[] {
  const convention = `${route.replaceAll('-', '_').toUpperCase()}_API_KEY`
  const extras: Readonly<Record<string, readonly string[]>> = {
    'kimi-coding': ['KIMI_API_KEY'],
    'opencode-go': ['OPENCODE_API_KEY'],
  }
  return [convention, ...(extras[route] ?? [])]
}

/** 宽容的凭据解析口：ref 名 → 非空值；未配置 / 解析失败返回 undefined。 */
export type RefResolver = (name: string) => Promise<string | undefined>

/** 依次解析候选 ref，返回第一个解析出非空值的 ref 与值；全部落空返回 undefined。 */
export async function firstResolvedRef(
  refs: readonly string[],
  resolveRef: RefResolver,
): Promise<{ ref: string; value: string } | undefined> {
  for (const ref of refs) {
    const value = await resolveRef(ref)
    if (value !== undefined) return { ref, value }
  }
  return undefined
}
