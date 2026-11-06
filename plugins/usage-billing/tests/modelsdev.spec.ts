import { applyBuiltinCatalog } from '../src/client/pricing.ts'
import { BUILTIN_MODEL_CATALOG, BUILTIN_MODEL_KEY_ALIASES } from '../src/builtin-catalog.ts'

// 测试套件承担宿主注入角色：目录与别名表在模块加载时全量注入（宿主 activate
// 同一入口），否则聚合/计价消费方读到空目录。
applyBuiltinCatalog(BUILTIN_MODEL_CATALOG, BUILTIN_MODEL_KEY_ALIASES)

/**
 * Live-pricing upstream unit tests: models.dev extra-model builder keeps only
 * mainstream providers, skips catalog-covered keys, drops unpriced rows, and
 * defaults the cache band to 10% of input when the source omits it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildExtraModels, fetchLivePricing } from '../src/pricing-fetch.ts'
import { applyLivePricing, computeCost, modelOf } from '../src/client/pricing.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  applyLivePricing({ source: 'builtin' })
})

describe('OpenRouter price wire format', () => {
  it('accepts decimal strings and numeric prices, preserves free cache reads, and rejects invalid prices', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('openrouter.ai') ? { data: [
        { id: 'openai/gpt-5.6-sol', pricing: { prompt: '0.000004', completion: '0.000020', input_cache_read: '0.0000004' } },
        { id: 'openai/gpt-6.1-sol', pricing: { prompt: '0.000002', completion: '0.000010', input_cache_read: '0.0000001' } },
        { id: 'openai/gpt-6-sol', pricing: { prompt: 0.000002, completion: 0.000010, input_cache_read: 0 } },
        { id: 'openai/gpt-6-luna', pricing: { prompt: '0.0000001', completion: '0.0000005' } },
        { id: 'anthropic/claude-opus-5.5', pricing: { prompt: '-1', completion: '0.000020' } },
        { id: 'anthropic/claude-sonnet-5.5', pricing: { prompt: '', completion: '0.000010' } },
        { id: 'anthropic/claude-haiku-5.5', pricing: { prompt: 'Infinity', completion: '0.0000005' } },
        { id: 'deepseek/deepseek-v4-pro', pricing: { prompt: null, completion: true } },
      ] } : {},
    ))))
    const snapshot = await fetchLivePricing()
    expect(snapshot.source).toBe('live')
    expect(Object.keys(snapshot.prices ?? {}).sort()).toEqual(['gpt-5.6-sol', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol'])
    applyLivePricing({ ...snapshot, rate: 1 })
    expect(computeCost(modelOf('gpt-5.6-sol'), {
      input: 1_000_000, cacheHit: 0, cacheMiss: 0, output: 1_000_000,
    }, 1, Date.UTC(2026, 10, 4))).toBeCloseTo(24, 10)
    expect(snapshot.prices?.['gpt-6.1-sol']?.input).toBeCloseTo(2, 10)
    expect(snapshot.prices?.['gpt-6.1-sol']?.output).toBeCloseTo(10, 10)
    expect(snapshot.prices?.['gpt-6.1-sol']?.cacheHit).toBeCloseTo(0.1, 10)
    expect(snapshot.prices?.['gpt-6-sol']?.cacheHit).toBe(0)
    expect(snapshot.prices?.['gpt-6-luna']?.cacheHit).toBeCloseTo(0.01, 10)
  })
})

describe('buildExtraModels', () => {
  const DATA = {
    deepseek: {
      models: {
        'deepseek-v4.5-flash': { name: 'DeepSeek V4.5 Flash', cost: { input: 1.2, output: 6, cache_read: 0.1 } },
        // 已在内置目录/别名表覆盖 → 跳过。
        'deepseek-v4-flash': { name: 'V4 Flash', cost: { input: 3, output: 9 } },
        // 免费 / 未公布价格 → 跳过。
        'deepseek-free': { name: 'Free', cost: { input: 0, output: 0 } },
      },
    },
    // 未映射厂商 → 整组跳过。
    'random-vendor': { models: { 'v1': { name: 'V1', cost: { input: 1, output: 2 } } } },
  }

  it('keeps every priced, non-catalog model regardless of provider whitelist', () => {
    const extras = buildExtraModels(DATA)
    // random-vendor 虽非主流厂商，但有价模型也会纳入（不再按白名单过滤）。
    // deepseek-v4-flash 经别名归一到 flash，命中内置目录 → 跳过。
    expect(extras).toHaveLength(2)
    expect(extras.map(e => e.key)).toContain('v1')
    expect(extras.find(e => e.key === 'deepseek-v4.5-flash')).toMatchObject({ provider: 'DeepSeek', name: 'DeepSeek V4.5 Flash' })
  })

  it('defaults the cache band to 10% of input when the source omits it', () => {
    const extras = buildExtraModels({
      deepseek: { models: { 'x': { name: 'X', cost: { input: 2, output: 10 } } } },
    })
    expect(extras[0]?.price.cacheHit).toBeCloseTo(0.2, 10)
  })

  it('returns an empty list for non-object or null input', () => {
    expect(buildExtraModels(null)).toEqual([])
    expect(buildExtraModels('nope')).toEqual([])
  })

  it('prefers the vendor listing over a reseller when both publish a price', () => {
    const extras = buildExtraModels({
      // 转售站排在前面：此前按遍历顺序会选中它。
      reseller: { name: 'Reseller', models: { 'acme-1': { name: 'Acme 1', family: 'acme', cost: { input: 9, output: 9 } } } },
      anthropic: { name: 'Anthropic', models: { 'acme-1': { name: 'Acme 1', family: 'acme', cost: { input: 5, output: 25, cache_read: 0.5 } } } },
    })
    expect(extras).toHaveLength(1)
    expect(extras[0]?.price).toMatchObject({ input: 5, output: 25, cacheHit: 0.5 })
  })

  it('falls back to the price most providers publish when no vendor lists it', () => {
    const cheap = { name: 'X', cost: { input: 0.05, output: 0.1 } }
    const common = { name: 'X', cost: { input: 1, output: 3 } }
    const extras = buildExtraModels({
      outlier: { models: { 'x-1': cheap } },
      a: { models: { 'x-1': common } },
      b: { models: { 'x-1': common } },
    })
    expect(extras[0]?.price).toMatchObject({ input: 1, output: 3 })
  })

  it('takes the median listing when no two providers agree', () => {
    const extras = buildExtraModels({
      low: { models: { 'y-1': { name: 'Y', cost: { input: 0.1, output: 0.1 } } } },
      mid: { models: { 'y-1': { name: 'Y', cost: { input: 1, output: 2 } } } },
      high: { models: { 'y-1': { name: 'Y', cost: { input: 50, output: 90 } } } },
    })
    expect(extras[0]?.price).toMatchObject({ input: 1, output: 2 })
  })

  it('prefers a declared cache_read over the input*0.1 guess at equal standing', () => {
    const extras = buildExtraModels({
      guessy: { models: { 'z-1': { name: 'Z', cost: { input: 10, output: 50 } } } },
      exact: { models: { 'z-1': { name: 'Z', cost: { input: 10, output: 50, cache_read: 0.25 } } } },
    })
    expect(extras[0]?.price.cacheHit).toBeCloseTo(0.25, 10)
  })

  it('emits one entry per catalog key', () => {
    const extras = buildExtraModels({
      a: { models: { 'dup-1': { name: 'D', cost: { input: 1, output: 2 } } } },
      b: { models: { 'dup-1': { name: 'D', cost: { input: 1, output: 2 } } } },
      c: { models: { 'dup-1': { name: 'D', cost: { input: 1, output: 2 } } } },
    })
    expect(extras.filter(e => e.key === 'dup-1')).toHaveLength(1)
  })

  it('names the model vendor rather than the winning price source', () => {
    const extras = buildExtraModels({
      tokengo: { name: 'TokenGo', models: { 'qwen/thing-1': { name: 'Thing', family: 'qwen', cost: { input: 1, output: 2 } } } },
      alibaba: { name: 'Alibaba', models: { 'qwen-other': { name: 'Other', family: 'qwen', cost: { input: 3, output: 4, cache_read: 0.3 } } } },
    })
    // MODELS_DEV_PROVIDERS 的映射优先于 models.dev 自带的 provider name。
    expect(extras.find(e => e.key === 'qwen/thing-1')?.provider).toBe('阿里通义')
  })

})
