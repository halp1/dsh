import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEARCH, SELECT, resolveConfig } from '../src/index.js';
import { fixture, runtime } from './runtime.js';

const names = (assembly) => assembly.tools.map((t) => t.name);
const text = (result) => JSON.parse(result.content[0].text);

test('config rejects typos, ambiguous namespaces and invalid limits', () => {
  for (const config of [{ nope: true }, { servers: [] }, { servers: ['rea', 'rea'] }, { servers: ['rea__other'] }, { maxSelectedTools: 0 }]) {
    assert.throws(() => resolveConfig(config));
  }
  assert.deepEqual(resolveConfig().servers, ['gworkspace', 'rea']);
});

test('cold request keeps unrelated tools but no managed schemas or server instructions', async (t) => {
  const f = await fixture(t);
  const assembly = await f.assemble();
  assert.deepEqual(names(assembly).sort(), ['bash', f.N, SEARCH, SELECT].sort());
  assert.equal(assembly.sections.some((s) => s.name === 'mcp:rea' || s.name === 'mcp:gworkspace'), false);
  assert.ok(assembly.sections.some((s) => s.name === 'mcp:n8n'));
  assert.ok(!JSON.stringify(assembly).includes('REA ORIGINAL GUIDANCE'));
});

test('search is bounded, paginated, schema-free and never activates tools', async (t) => {
  const f = await fixture(t);
  const summary = text(await f.call(SEARCH, {}));
  assert.equal(summary.servers.find((s) => s.server === 'rea').tools, 1);
  const result = text(await f.call(SEARCH, { query: 'decompile native' }));
  assert.equal(result.tools[0].name, f.R);
  assert.ok(result.tools[0].description.length <= 240);
  assert.ok(result.tools[0].schemaBytes > 10000);
  assert.equal(JSON.stringify(result).includes('parameters'), false);
  assert.equal(names(await f.assemble()).includes(f.R), false);
  for (let i = 0; i < 12; i++) f.ctx.tools.register(f.nativeTool(`mcp__rea__other_${i}`));
  const page = text(await f.call(SEARCH, { server: 'rea', limit: 10 }));
  assert.equal(page.tools.length, 10);
  assert.equal(page.nextOffset, 10);
  const rest = text(await f.call(SEARCH, { server: 'rea', offset: page.nextOffset }));
  assert.equal(rest.tools.length, 3);
  assert.equal(rest.nextOffset, null);
  const invalid = await f.call(SEARCH, { limit: 11 });
  assert.equal(invalid.isError, true);
});

test('selection exposes only exact original schemas and preserves native execution validation', async (t) => {
  const f = await fixture(t);
  const blocked = await f.call(f.R, { input: 'x' });
  assert.equal(blocked.isError, true);
  const selected = await f.call(SELECT, { action: 'add', names: [f.R, f.R] });
  assert.equal(selected.isError, false, JSON.stringify(selected));
  assert.deepEqual(text(selected).selected, [f.R]);
  assert.ok(!selected.content[0].text.includes('selection'));
  const assembly = await f.assemble();
  assert.ok(names(assembly).includes(f.R));
  assert.ok(!names(assembly).includes(f.G));
  assert.deepEqual(assembly.tools.find((t) => t.name === f.R), f.ctx.tools.schemas(f.agent).find((t) => t.name === f.R));
  assert.ok(assembly.sections.some((s) => s.name === 'mcp:rea' && s.text === 'REA ORIGINAL GUIDANCE'));
  assert.equal((await f.call(f.R, {})).isError, true);
  assert.equal((await f.call(f.R, { input: 'ok' })).isError, false);
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, [f.R]);
});

test('add/remove/replace/status, limits and unknown names are atomic', async (t) => {
  const f = await fixture(t, { config: { maxSelectedTools: 1 } });
  await f.call(SELECT, { action: 'add', names: [f.R] });
  assert.equal((await f.call(SELECT, { action: 'add', names: [f.G] })).isError, true);
  assert.equal((await f.call(SELECT, { action: 'replace', names: [f.G, 'mcp__rea__unknown'] })).isError, true);
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, [f.R]);
  assert.equal((await f.call(SELECT, { action: 'replace', names: [f.G] })).isError, false);
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, [f.G]);
  await f.call(SELECT, { action: 'remove', names: [f.G] });
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, []);
  await f.call(SELECT, { action: 'add', names: [f.R] });
  await f.call(SELECT, { action: 'replace', names: [] });
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, []);
});

test('independent chats, same-session restore, and forks do not share selection', async (t) => {
  const f = await fixture(t);
  await f.call(SELECT, { action: 'add', names: [f.G] });
  const second = f.makeAgent();
  assert.ok(!names(await f.assemble(second)).includes(f.G));
  const history = f.agent.session.snapshotEvents();
  const restored = f.makeAgent(history);
  assert.ok(names(await f.assemble(restored)).includes(f.G));
  const fork = f.makeAgent(history, { isSeeded: true, parentSession: f.agent.session.id }, history.length);
  assert.ok(!names(await f.assemble(fork)).includes(f.G));
  assert.ok(!history.some((event) => event.type.startsWith('mcp-discovery/')));
  // Names live in normal result metadata, never in an unknown event type.
  const metadata = history.find((e) => e.data?.meta?.dshMcpDiscovery)?.data.meta;
  assert.deepEqual(metadata.dshMcpDiscovery, { version: 1, names: [f.G] });
});

test('restrictions apply to discovery, selection and execution, including revoked selected tools', async (t) => {
  const f = await fixture(t);
  await f.call(SELECT, { action: 'add', names: [f.G] });
  f.agent.ctx.tools.restrict({ deny: [f.R, f.G] });
  const result = text(await f.call(SEARCH, { query: 'gmail decompile' }));
  assert.deepEqual(result.tools, []);
  assert.equal((await f.call(SELECT, { action: 'add', names: [f.R] })).isError, true);
  assert.equal((await f.call(f.G, { input: 'no' })).isError, true);
  assert.ok(!names(await f.assemble()).includes(f.G));
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, []);
  // Keeping a now-restricted name in non-model metadata must not prevent clearing.
  assert.equal((await f.call(SELECT, { action: 'replace', names: [] })).isError, false);
});

test('catalog changes use fresh definitions and no stale executable closure', async (t) => {
  const f = await fixture(t);
  await f.call(SELECT, { action: 'add', names: [f.R] });
  f.disposers[0]();
  assert.ok(!names(await f.assemble()).includes(f.R));
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).unavailable, [f.R]);
  f.ctx.tools.register(f.nativeTool(f.R, 'NEW SCHEMA', async () => ({ generation: 2 })));
  assert.equal((await f.assemble()).tools.find((t) => t.name === f.R).description, 'NEW SCHEMA');
  assert.equal(text(await f.call(f.R, { input: 'yes' })).generation, 2);
});

test('normal approvals and read-only policy still block selected writes', async (t) => {
  const f = await fixture(t);
  await f.call(SELECT, { action: 'add', names: [f.G] });
  f.ctx.on('tools/pre-execute', async (exec, next) => exec.name === f.G ? { kind: 'ask', reason: 'Approve write' } : next(), { global: true });
  const result = await f.call(f.G, { input: 'write' });
  assert.equal(result.isError, true); // No approval service: must fail closed.
  assert.match(result.content[0].text, /approv/i);
});

test('cancelled and post-policy-blocked selections do not mutate state', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await f.call(SELECT, { action: 'add', names: [f.G] }, f.agent, { signal: controller.signal })).isError, true);
  const undo = f.ctx.on('tools/post-execute', async (exec, result, next) => exec.name === SELECT
    ? { kind: 'block', feedback: [{ type: 'text', text: 'POLICY BLOCK' }] } : next(), { global: true });
  assert.equal((await f.call(SELECT, { action: 'add', names: [f.G] })).isError, true);
  undo();
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, []);
});

test('executor-owned schemas stay filtered even when a waterfall returns eager tools', async (t) => {
  const f = await fixture(t);
  f.ctx.on('system-prompt/assemble', async (assembly, _context, next) => ({
    ...await next(), tools: f.ctx.tools.schemas(f.agent),
  }), { global: true });
  assert.ok(!names(await f.assemble()).includes(f.R));
  await f.call(SELECT, { action: 'add', names: [f.G] });
  const toolSet = await f.ctx.tools.resolve({ agent: f.agent, signal: new AbortController().signal });
  try {
    const warm = await f.assemble(f.agent, { toolSet });
    assert.ok(names(warm).includes(f.G));
    assert.ok(!names(warm).includes(f.R));
    toolSet.dispose();
    assert.deepEqual(names(await f.assemble(f.agent, { toolSet })), []);
  } finally { toolSet.dispose(); }
});

test('unsupported scoped executors fail without exposing their generated SDK', async (t) => {
  const f = await fixture(t);
  f.agent.ctx.tools.setExecutor({
    sections: [{ name: 'tools:sdk', order: 5000, text: 'all tools' }],
    describe: () => ({ schemas: [{ name: 'run_code', description: 'program', parameters: { type: 'object' } }] }),
    execute: () => { throw new Error('must not execute'); },
  });
  await assert.rejects(f.assemble(), /PTC|native/);
  // The sibling still uses the original native executor and remains lazy.
  assert.ok(!names(await f.assemble(f.makeAgent())).includes(f.G));
});

test('provider history projection uses only current selected schemas on non-native-defer routes', async (t) => {
  const f = await fixture(t);
  const { projectToolUpdates } = await runtime('dsh-llm');
  const cold = await f.assemble();
  const eagerHistory = { tools: f.ctx.tools.schemas(f.agent), updates: [] };
  const projected = projectToolUpdates([], cold.tools, undefined, eagerHistory);
  assert.ok(!projected.tools.some((tool) => tool.name === f.R || tool.name === f.G));
  await f.call(SELECT, { action: 'add', names: [f.G] });
  const warm = await f.assemble();
  const next = projectToolUpdates([], warm.tools, undefined, eagerHistory);
  assert.ok(next.tools.some((tool) => tool.name === f.G));
  assert.ok(!next.tools.some((tool) => tool.name === f.R));
  assert.ok(!next.tools.some((tool) => tool.deferLoading));
});
