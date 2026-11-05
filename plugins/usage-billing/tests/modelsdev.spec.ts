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
})
