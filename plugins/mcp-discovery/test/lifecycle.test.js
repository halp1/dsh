import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Discovery, SELECT, resolveConfig } from '../src/index.js';
import { fixture } from './runtime.js';
const text = (result) => JSON.parse(result.content[0].text);

test('post-policy value replacements cannot create durable activation metadata', async (t) => {
  const f = await fixture(t);
  const undo = f.ctx.on('tools/post-execute', async (exec, result, next) => exec.name === SELECT ? {
    kind: 'accept', value: { ...result.value, selected: [f.R], selection: { version: 1, names: [f.R] } },
  } : next(), { global: true });
  const result = await f.call(SELECT, { action: 'add', names: [f.G] });
  assert.equal(result.isError, false);
  assert.deepEqual(result.meta, {});
  undo();
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, []);
  const restored = f.makeAgent(f.agent.session.snapshotEvents());
  assert.ok(!(await f.assemble(restored)).tools.some((tool) => tool.name === f.R || tool.name === f.G));
});

test('compaction replacement of an old result never resurrects removed tools', async (t) => {
  const f = await fixture(t);
  await f.call(SELECT, { action: 'add', names: [f.R] });
  const previous = f.agent.session.snapshotEvents().find((e) => e.type === 'tool/result');
  await f.call(SELECT, { action: 'replace', names: [] });
  // Equivalent to the result-pruner preserving data/meta in a later replacement.
  f.agent.session.append('tool/result', previous.data, {
    surfaceOp: { op: 'replace', startSeq: previous.seq, endSeq: previous.seq }, sourceEventSeqs: [previous.seq],
  });
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, []);
  const restored = f.makeAgent(f.agent.session.snapshotEvents());
  assert.ok(!(await f.assemble(restored)).tools.some((tool) => tool.name === f.R));
});

test('only the latest snapshot is validated against changed limits and namespaces', async (t) => {
  const f = await fixture(t);
  await f.call(SELECT, { action: 'add', names: [f.R, f.G] });
  await f.call(SELECT, { action: 'replace', names: [] });
  const restored = f.makeAgent(f.agent.session.snapshotEvents());
  const smaller = new Discovery(f.ctx, resolveConfig({ servers: ['rea'], maxSelectedTools: 1 }));
  assert.deepEqual([...smaller.state(restored.session)], []);
});

test('cancel during native execution is still cancelled after selection', async (t) => {
  const f = await fixture(t);
  f.disposers[0]();
  const controller = new AbortController();
  f.ctx.tools.register(f.nativeTool(f.R, 'cooperative abort', async (_args, exec) => {
    controller.abort();
    exec.signal.throwIfAborted();
  }));
  await f.call(SELECT, { action: 'add', names: [f.R] });
  const result = await f.call(f.R, { input: 'run' }, f.agent, { signal: controller.signal });
  assert.equal(result.isError, true);
});

test('native image projection and output contracts are preserved unchanged', async (t) => {
  const f = await fixture(t);
  f.disposers[0]();
  const image = {
    type: 'image', attachment: { attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 70, width: 1, height: 1 },
  };
  const original = f.nativeTool(f.R, 'image result', async () => ({ observed: true }));
  original.projectContent = (_exec, result) => result.isError ? undefined : [image];
  f.ctx.tools.register(original);
  const before = f.ctx.tools.get(f.R, f.agent);
  await f.call(SELECT, { action: 'add', names: [f.R] });
  assert.equal(f.ctx.tools.get(f.R, f.agent), before);
  const result = await f.call(f.R, { input: 'capture' });
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [image]);
});

test('selection changes need not execute any managed MCP tool', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.disposers[0]();
  f.ctx.tools.register(f.nativeTool(f.R, 'never call during selection', async () => { calls++; return {}; }));
  await f.call(SELECT, { action: 'add', names: [f.R] });
  await f.call(SELECT, { action: 'status' });
  await f.call(SELECT, { action: 'replace', names: [] });
  assert.equal(calls, 0);
});

test('scope restrictions on the discovery controls themselves are not lifted', async (t) => {
  const f = await fixture(t);
  f.agent.ctx.tools.restrict({ allow: [f.G] });
  assert.equal((await f.call(SELECT, { action: 'add', names: [f.G] })).isError, true);
  assert.equal((await f.call(f.G, { input: 'x' })).isError, true);
  const assembly = await f.assemble();
  assert.deepEqual(assembly.tools, []);
  assert.ok(!assembly.sections.some((s) => s.name === 'mcp-discovery:guide'));
});

test('plugin restart restores selection; disposal restores eager behavior without stale guards', async (t) => {
  const f = await fixture(t);
  await f.call(SELECT, { action: 'add', names: [f.G] });
  await f.plugin.restart();
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, [f.G]);
  assert.ok(!(await f.assemble()).tools.some((tool) => tool.name === f.R));
  await f.plugin.dispose();
  const assembly = await f.assemble();
  assert.ok(assembly.tools.some((tool) => tool.name === f.R));
  assert.ok(assembly.tools.some((tool) => tool.name === f.G));
  assert.ok(!assembly.tools.some((tool) => tool.name === SELECT));
  assert.equal((await f.call(f.R, { input: 'x' })).isError, false);
  await f.install();
  assert.ok(!(await f.assemble()).tools.some((tool) => tool.name === f.R));
  assert.deepEqual(text(await f.call(SELECT, { action: 'status' })).selected, [f.G]);
});

test('bytes report managed serialized declarations without mislabeling tokens', async (t) => {
  const f = await fixture(t);
  const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
  const eager = f.ctx.tools.schemas(f.agent);
  const fullBytes = eager.reduce((total, tool) => total + bytes(tool), 0);
  const cold = await f.assemble();
  assert.ok(cold.tools.reduce((total, tool) => total + bytes(tool), 0) < fullBytes / 10);
  const status = text(await f.call(SELECT, { action: 'status' }));
  assert.equal(status.selectedSchemaBytes, 0);
  assert.equal(status.availableSchemaBytes, eager.filter((tool) => tool.name === f.R || tool.name === f.G).reduce((total, tool) => total + bytes(tool), 0));
});
