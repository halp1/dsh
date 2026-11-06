import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, resolveConfig } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import { Config, runtimeOptions } from '../src/config.js'

const secret = 'test-only-settings-credential'

test('Host schema validates credentials and Settings redaction exposes presence without values', () => {
  const resolved = resolveConfig({ Config }, { apiKey: secret })
  assert.equal(runtimeOptions(resolved).getApiKey(), secret)
  assert.equal(JSON.stringify(runtimeOptions(resolved).policy).includes(secret), false)
  const described = redactSecrets(Config, { apiKey: secret, enabled: true })
  assert.deepEqual(described.secrets, [{ path: ['apiKey'], set: true }])
  assert.equal(Object.hasOwn(described.value, 'apiKey'), false)
  assert.equal(JSON.stringify(described).includes(secret), false)
  assert.deepEqual(redactSecrets(Config, {}).secrets, [{ path: ['apiKey'], set: false }])
  for (const apiKey of ['has space', 'line\nbreak', 'tab\tkey', 'control\x00key', 'zero\u200bwidth', 'x'.repeat(4097), 123, {}]) {
    assert.throws(() => resolveConfig({ Config }, { apiKey }))
  }
})

test('real Loader rotates and resets the live secret without remounting or retaining it in policy', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  let mounts = 0
  let runtime
  ctx.loader.builtins['credential-fixture'] = {
    Config,
    apply(_ctx, config) {
      mounts += 1
      runtime = runtimeOptions(config)
    },
  }
  const id = await ctx.loader.create({ name: 'cordis:credential-fixture', config: { apiKey: secret } })
  await ctx.loader.await()
  assert.equal(mounts, 1)
  assert.equal(runtime.getApiKey(), secret)
  const initial = runtime
  await ctx.loader.update(id, { config: { apiKey: 'rotated-test-only-credential' } })
  assert.equal(runtime, initial)
  assert.equal(mounts, 1)
  assert.equal(runtime.getApiKey(), 'rotated-test-only-credential')
  await ctx.loader.update(id, { config: {} })
  assert.equal(mounts, 1)
  assert.equal(runtime.getApiKey(), '')
  assert.equal(JSON.stringify(runtime.policy).includes('credential'), false)
  // Loader reports entry errors through diagnostics, not a rejected update Promise.
  await ctx.loader.update(id, { config: { apiKey: 'invalid key' } })
  assert.equal(runtime.getApiKey(), '')
})
