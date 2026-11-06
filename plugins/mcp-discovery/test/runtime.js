import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { apply, inject } from '../src/index.js';

// Exercise the installed runtime, not a copied or mocked registry implementation.
const require = createRequire(process.env.DSH_TEST_RUNTIME ?? resolve(dirname(process.execPath), '../lib/node_modules/@deepseek-ai/dsh/package.json'));
export const runtime = async (name) => import(require.resolve(`@deepseek-ai/${name}`));
const { Context } = await runtime('cordis');
const { SystemPrompt } = await runtime('dsh-system-prompt');
const { ToolRuntime, defineTool } = await runtime('dsh-tools');
const NativeExecutor = await runtime('dsh-tool-executor-native');
const { Session } = await runtime('dsh-session');
const { createScope } = await runtime('dsh-scope');
const { createToolResultMessage } = await runtime('dsh-llm');

let ids = 0;
export const nativeTool = (name, description = name, execute = async (args) => args) => defineTool({
  name, description, parameters: { input: { type: 'string', required: true } },
  output: { schema: { type: 'object', additionalProperties: true }, render: (_a, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute,
});

export async function fixture(t, options = {}) {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {}).await();
  await ctx.plugin(ToolRuntime, {}).await();
  await ctx.plugin(NativeExecutor, {}).await();
  if (options.setup) await options.setup(ctx);
  const R = 'mcp__rea__decompile';
  const G = 'mcp__gworkspace__search_gmail_messages';
  const N = 'mcp__n8n__list_workflows';
  const disposers = [
    ctx.tools.register(nativeTool(R, 'Decompile native function to pseudocode. '.repeat(1000))),
    ctx.tools.register(nativeTool(G, 'Search Gmail email messages')),
    ctx.tools.register(nativeTool(N)),
    ctx.tools.register(nativeTool('bash')),
  ];
  ctx.systemPrompt.section({ name: 'mcp:rea', order: 10, text: 'REA ORIGINAL GUIDANCE' });
  ctx.systemPrompt.section({ name: 'mcp:gworkspace', order: 10, text: 'GOOGLE ORIGINAL GUIDANCE' });
  ctx.systemPrompt.section({ name: 'mcp:n8n', order: 10, text: 'N8N ORIGINAL GUIDANCE' });
  const install = async () => {
    const plugin = ctx.plugin({ name: 'test-discovery', apply, inject }, options.config ?? {});
    await plugin.await();
    return plugin;
  };
  const plugin = await install();
  const scopeOwner = await ctx.plugin({ name: 'fixture-agents', inject, apply() {} }).await();
  t.after(async () => { await ctx.fiber.dispose(); });
  const makeAgent = (seed = [], meta = {}, inheritedEventCount) => {
    const id = `test-${++ids}`;
    const header = { version: 4, id, createdAt: Date.now(), isSeeded: false, ...meta };
    const agent = { session: Session.create(id, seed, header, inheritedEventCount), status: { kind: 'idle' } };
    const scoped = createScope(scopeOwner.ctx, agent);
    agent.ctx = scoped.ctx;
    return agent;
  };
  const agent = makeAgent();
  const assemble = (a = agent, context = {}) => ctx.systemPrompt.assemble({ scope: a, agent: a, ...context });
  let callCounter = 0;
  const call = async (name, args, a = agent, extra = {}) => {
    const callId = `call-${++callCounter}`;
    a.session.append('tool/call', { turn: 1, step: callCounter, callId, name, arguments: JSON.stringify(args) });
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool_call', id: callId, name, arguments: JSON.stringify(args) }],
      agent: a, signal: new AbortController().signal, ...extra,
    });
    const result = batch.results[0].result;
    const message = createToolResultMessage({ callId, content: result.content, isError: result.isError });
    a.session.append('tool/result', { turn: 1, step: callCounter, message, ...(result.meta === undefined ? {} : { meta: result.meta }) }, { surfaceOp: 'append' });
    return result;
  };
  return { ctx, agent, makeAgent, assemble, call, plugin, install, disposers, R, G, N, nativeTool };
}
