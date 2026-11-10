import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as ask from '../src/index.js'

/** Fake agent recording the inbox calls and log appends a command makes. */
function fakeAgent() {
  const calls = []
  const events = []
  return {
    calls,
    events,
    session: { append: (type, data) => events.push({ type, data }) },
    inject: (message) => calls.push(['inject', message]),
    steer: (message) => calls.push(['steer', message]),
  }
}

async function runtime() {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime).await()
  await ctx.plugin(ask).await()
  return ctx
}

test('/ask steers the question behind the hands-off notice, through the real registry', async () => {
  const ctx = await runtime()
  const agent = fakeAgent()
  const image = { type: 'image', mimeType: 'image/png', data: 'AA==' }
  const descriptor = ctx.commands.list(agent).find((entry) => entry.name === 'ask')
  assert.equal(descriptor.input.attachments, true)

  const { result } = await ctx.commands.execute(agent, '/ask  why is the build slow? ', [], new AbortController().signal)
  assert.equal(result.kind, 'success')
  assert.deepEqual(agent.calls.map(([kind]) => kind), ['inject', 'steer'])
  const [[, context], [, prompt]] = agent.calls
  assert.equal(context.role, 'user')
  assert.equal(context.source.kind, 'ask')
  assert.equal(context.source.form, 'notice')
  assert.ok(context.source.summary.length <= 120)
  assert.deepEqual(prompt.source, { kind: 'user' })
  assert.deepEqual(prompt.content, [{ type: 'text', text: 'why is the build slow?' }])
  // The steered message owns the question, so the command log does not duplicate it.
  assert.equal(agent.events.find((event) => event.type === 'command/run').data.args, undefined)

  // Attachments alone are a question. They keep selection order ahead of the text.
  const { prompt: withImage } = ask.askMessages('what is this?', [image])
  assert.deepEqual(withImage.content.map((block) => block.type), ['image', 'text'])
  assert.deepEqual(ask.askMessages('', [image]).prompt.content, [image])
})

test('/ask without a question errors and submits nothing', async () => {
  const ctx = await runtime()
  for (const line of ['/ask', '/ask    ']) {
    const agent = fakeAgent()
    const { result } = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    assert.equal(result.kind, 'error')
    assert.deepEqual(agent.calls, [])
  }
})
