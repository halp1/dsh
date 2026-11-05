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
export const PROVIDER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'DeepSeek': ['deepseek'],
  '智谱 AI': ['zhipu', 'glm', 'z.ai'],
  '阿里通义': ['qwen', 'tongyi', 'dashscope', 'aliyun'],
  '字节豆包': ['doubao', 'volcengine', 'ark'],
  '月之暗面': ['moonshot', 'kimi'],
  '小米': ['xiaomi', 'mi', 'mimo'],
  'MiniMax': ['minimax'],
  '百度文心': ['ernie', 'wenxin', 'qianfan', 'baidu'],
  '腾讯混元': ['hunyuan', 'tencent'],
  '零一万物': ['01.ai', 'lingyi', 'yi'],
  '阶跃星辰': ['step', 'stepfun', 'step-3.7'],
  '科大讯飞': ['spark', 'xfyun', 'iflytek'],
  '商汤': ['sensenova', 'sensetime'],
  '百川智能': ['baichuan'],
  'OpenAI': ['openai'],
  'Google': ['google', 'gemini'],
  'xAI': ['xai', 'grok'],
  'Meta': ['meta', 'llama'],
  'Anthropic': ['claude', 'anthropic'],
  'Mistral AI': ['mistral', 'ministral', 'devstral'],
  'Cohere': ['cohere', 'command'],
  '美团': ['longcat', 'meituan'],
  '面壁智能': ['minicpm', 'modelbest'],
  '小红书': ['dots', 'rednote', 'xiaohongshu'],
  '云知声': ['unisound', 'u2'],
}

/** Normalize a provider name for dot matching: lower case, no spaces. */
export function normalizeProvider(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_/-]+/g, '')
}

/** Whether one normalized name is a substring of the other (length-guarded). */
export function providerNameHits(display: string, live: string): boolean {
  if (display.length === 0 || live.length === 0) return false
  if (display === live) return true
  const [short, long] = display.length <= live.length ? [display, live] : [live, display]
  // 太短的片段（如单字母）不做子串判断，避免误匹配。
  return short.length >= 3 && long.includes(short)
}

/** Whether a catalog display name matches one live provider name. */
export function providerMatches(display: string, live: string): boolean {
  const displayKey = normalizeProvider(display)
  const liveKey = normalizeProvider(live)
  if (providerNameHits(displayKey, liveKey)) return true
  const aliases = PROVIDER_ALIASES[display]
  return aliases !== undefined && aliases.some(alias => providerNameHits(normalizeProvider(alias), liveKey))
}

/**
 * 从真实 model id 反推提供方显示名：目录未收录的模型（key 落回「其他」）
 * 只靠 entry.provider（Custom）永远点不亮健康灯，这里用厂商别名对 model id
 * 做强匹配（别名作为完整 id / 前缀 / 独立段）与弱匹配（长别名子串），
 * 命中即显示厂商名并点亮健康点；无命中保持 Custom。
 * 导出供守卫测试：短别名（mi/yi）仅允许前缀形式，防止 minimax 等误吞。
 */
export function providerFromModelKey(modelKey: string): string | undefined {
  // 强匹配保留原始连字符（normalize 会吞掉 `-`，前缀/独立段判断就失效了）。
  const key = modelKey.trim().toLowerCase()
  const compact = key.replace(/[\s_/-]+/g, '')
  if (compact.length === 0) return undefined
  // 强匹配：别名作为完整 id 或前缀/独立段（deepseek-chat、qwen-max、mi-mimo-2.5）。
  for (const [display, aliases] of Object.entries(PROVIDER_ALIASES)) {
    for (const alias of aliases) {
      const a = normalizeProvider(alias)
      if (a.length === 0) continue
      if (key === a) return display
      if (key.startsWith(`${a}-`) || key.startsWith(`${a}/`) || key.startsWith(`${a}_`)) return display
      if (key.includes(`${a}-`) || key.includes(`${a}/`) || key.includes(`${a}_`)) return display
    }
  }
  // 弱匹配：长别名（≥4 字符）作为 id 子串（mimo2.5 → mimo → 小米）；短别名
  // 已在强匹配覆盖（前缀形式），这里不参与，避免误配。
  for (const [display, aliases] of Object.entries(PROVIDER_ALIASES)) {
    for (const alias of aliases) {
      const a = normalizeProvider(alias)
      if (a.length < 4) continue
      if (compact.includes(a)) return display
    }
  }
  return undefined
}
