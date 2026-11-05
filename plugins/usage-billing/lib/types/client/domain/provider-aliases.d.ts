/**
 * 厂商别名与匹配：PROVIDER_ALIASES 是中文厂商显示名 → 多英文/拼音别名
 * 列表，反向查 `providerFromModelKey` 用作「目录未收录」模型的兜底厂商推断。
 * 纯函数，无 React 依赖；导出供测试。
 */
/**
 * The dashboard's display names (中文厂商名) never equal the provider names a
 * user actually configures (deepseek, zhipu, qwen…), so the dot match also
 * accepts a bidirectional substring hit and a display-name alias list.
 * 导出供一致性守卫测试：catalog 每个厂商都必须在此登记（Custom 除外），
 * 防止新增厂商漏配导致健康绿灯不亮。
 */
export declare const PROVIDER_ALIASES: Readonly<Record<string, readonly string[]>>;
/** Normalize a provider name for dot matching: lower case, no spaces. */
export declare function normalizeProvider(name: string): string;
/** Whether one normalized name is a substring of the other (length-guarded). */
export declare function providerNameHits(display: string, live: string): boolean;
/** Whether a catalog display name matches one live provider name. */
export declare function providerMatches(display: string, live: string): boolean;
/**
 * 从真实 model id 反推提供方显示名：目录未收录的模型（key 落回「其他」）
 * 只靠 entry.provider（Custom）永远点不亮健康灯，这里用厂商别名对 model id
 * 做强匹配（别名作为完整 id / 前缀 / 独立段）与弱匹配（长别名子串），
 * 命中即显示厂商名并点亮健康点；无命中保持 Custom。
 * 导出供守卫测试：短别名（mi/yi）仅允许前缀形式，防止 minimax 等误吞。
 */
export declare function providerFromModelKey(modelKey: string): string | undefined;
//# sourceMappingURL=provider-aliases.d.ts.map