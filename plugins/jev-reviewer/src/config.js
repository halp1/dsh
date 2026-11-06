import z from '@deepseek-ai/schemastery'

/** Only the credential is live-editable. DSH redacts its value from Settings reads. */
export const Config = z.object({
  enabled: z.boolean().default(true),
  model: z.string().pattern(/^jev-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/).max(128).default('jev-1.14.0'),
  timeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(10_000),
  maxStateBytes: z.number().step(1).min(1).max(1_048_576).default(65_536),
  allowProbability: z.number().min(0).max(1).default(0.90),
  rejectProbability: z.number().min(0).max(1).default(0.99),
  minConfidence: z.number().min(0).max(1).default(0.80),
  apiKey: z.string().max(4096).pattern(/^[^\s\p{Cc}\p{Cf}]+$/u)
    .role('secret').description('TypeSafe API key. Unset to use TYPESAFE_API_KEY.').volatile(),
})

/** Keep the live secret reference out of policy snapshots and model state. */
export function runtimeOptions(rawConfig) {
  const { apiKey, ...policy } = rawConfig
  return {
    policy,
    getApiKey: () => (typeof apiKey?.get === 'function' ? apiKey.get() : apiKey) ?? '',
  }
}
