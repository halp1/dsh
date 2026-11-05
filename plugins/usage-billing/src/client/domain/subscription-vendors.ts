/**
 * 订阅套餐 provider id → 所属模型厂商：用于把订阅额度归并到对应厂商组。
 * 厂商名与 PROVIDER_ALIASES 保持一致，使订阅卡片与模型用量落在同一组下。
 * opencode 是跨厂商订阅通道、无单一模型厂商，按自身显示名独立成组。
 */

import { providerFromModelKey } from './provider-aliases.ts'

export const SUBSCRIPTION_VENDORS: Readonly<Record<string, string>> = {
  'kimi-coding': '月之暗面',
  'zai-coding-cn': '智谱 AI',
  'zai-coding': '智谱 AI',
  'qwen-token-plan': '阿里通义',
  'qwen-token-plan-cn': '阿里通义',
  'xiaomi-token-plan-ams': '小米',
  'xiaomi-token-plan-cn': '小米',
  'xiaomi-token-plan-sgp': '小米',
  'volcengine-token-plan': '字节豆包',
  'ark-token-plan': '字节豆包',
  'doubao-token-plan': '字节豆包',
  'ernie': '百度文心',
  'baidu': '百度文心',
  'wenxin': '百度文心',
  'minimax': 'MiniMax',
  'minimax-cn': 'MiniMax',
  'minimax-token-plan': 'MiniMax',
  'minimax-token-plan-cn': 'MiniMax',
  'hunyuan-token-plan': '腾讯混元',
  'tencent-token-plan': '腾讯混元',
  'hy-token-plan': '腾讯混元',
  'xinghuo-token-plan': '讯飞星火',
  'xfyun-coding': '讯飞星火',
  'spark-coding': '讯飞星火',
  'huawei-token-plan': '华为云',
  'pangu-token-plan': '华为云',
  'huawei-maas-token-plan': '华为云',
  'volcengine-agent-plan': '字节豆包',
  'ark-agent-plan': '字节豆包',
  'baidu-token-plan': '百度文心',
  'ernie-token-plan': '百度文心',
  'wenxin-token-plan': '百度文心',
  'opencode': 'OpenCode',
  'opencode-go': 'OpenCode',
}

/** 仅供测试：暴露厂商映射表（subscriptionVendorOf 仍是唯一消费入口）。 */
export const SUBSCRIPTION_VENDORS_FOR_TEST: Readonly<Record<string, string>> = SUBSCRIPTION_VENDORS

/** 订阅套餐归并到的厂商显示名；未知 id 回退为从 model id 反推或 id 本身。 */
export function subscriptionVendorOf(provider: string): string {
  const mapped = SUBSCRIPTION_VENDORS[provider]
  if (mapped !== undefined) return mapped
  return providerFromModelKey(provider) ?? provider
}
