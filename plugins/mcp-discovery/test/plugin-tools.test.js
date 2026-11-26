import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Discovery, SEARCH, SELECT, resolveConfig } from '../src/index.js';
import { fixture } from './runtime.js';
const names = (assembly) => assembly.tools.map((tool) => tool.name);
const text = (result) => JSON.parse(result.content[0].text);

// Exercise original registrations through the native pipeline, not a discovery proxy.
test('browser tools are hidden until selected and other plugin tools can opt into discovery', async (t) => {
  const f = await fixture(t, { config: { prefixes: [
    { prefix: 'dsh_browser_', mode: 'on-demand' }, { prefix: 'widget_', mode: 'on-demand' },
  ] } });
  for (const name of ['dsh_browser_open', 'dsh_browser_snapshot', 'widget_search', 'other_plugin']) {
    f.ctx.tools.register(f.nativeTool(name, `${name} plugin capability`));
  }
  const cold = names(await f.assemble());
  assert.ok(!cold.includes('dsh_browser_open') && !cold.includes('widget_search'));
  assert.ok(cold.includes('other_plugin'));
  const summary = text(await f.call(SEARCH, {}));
  assert.ok(summary.plugins.some((group) => group.prefix === 'dsh_browser_' && group.tools === 2));
  const search = text(await f.call(SEARCH, { prefix: 'dsh_browser_' }));
  assert.deepEqual(search.tools.map((tool) => tool.name), ['dsh_browser_open', 'dsh_browser_snapshot']);
  assert.ok(!JSON.stringify(search).includes('parameters'));
  assert.equal((await f.call('dsh_browser_open', { input: 'before' })).isError, true);
  await f.call(SELECT, { action: 'add', names: ['dsh_browser_open', 'widget_search'] });
  const warm = names(await f.assemble());
  assert.ok(warm.includes('dsh_browser_open') && warm.includes('widget_search'));
  assert.ok(!warm.includes('dsh_browser_snapshot'));
  assert.equal((await f.call('dsh_browser_open', { input: 'native' })).isError, false);
  const resumed = f.makeAgent(f.agent.session.snapshotEvents());
  assert.ok(names(await f.assemble(resumed)).includes('widget_search'));
  assert.ok(!names(await f.assemble(f.makeAgent())).includes('widget_search'));
});

test('live policy changes revoke saved selections, blocked tools never enter search or dispatch', async (t) => {
  const f = await fixture(t);
  f.ctx.tools.register(f.nativeTool('dsh_browser_open'));
  await f.call(SELECT, { action: 'add', names: ['dsh_browser_open', f.R] });
  const discovery = new Discovery(f.ctx, resolveConfig());
  assert.deepEqual([...discovery.state(f.agent.session)].sort(), ['dsh_browser_open', f.R].sort());
  discovery.updateConfig({ prefixes: [{ prefix: 'dsh_browser_', mode: 'blocked' }], tools: [{ name: f.R, mode: 'blocked' }] });
  const exec = { name: 'dsh_browser_open', agent: f.agent, signal: new AbortController().signal };
  assert.ok(discovery.guard(exec));
  assert.deepEqual([...discovery.state(f.agent.session)], []);
  const catalog = discovery.search({ query: 'browser decompile' }, exec);
  assert.deepEqual(catalog.tools, []);
  assert.throws(() => discovery.select({ action: 'add', names: ['dsh_browser_open'] }, exec));
  const blocked = discovery.filter({ tools: f.ctx.tools.schemas(f.agent), sections: [] }, { scope: f.agent });
  assert.ok(!names(blocked).includes('dsh_browser_open') && !names(blocked).includes(f.R));
  discovery.updateConfig({ prefixes: [{ prefix: 'dsh_browser_', mode: 'on-demand' }] });
  assert.ok(discovery.guard(exec));
  assert.ok(!names(discovery.filter({ tools: f.ctx.tools.schemas(f.agent), sections: [] }, { scope: f.agent })).includes('dsh_browser_open'));
});

test('exact rules override longest prefixes and scoped restrictions still win', async (t) => {
  const f = await fixture(t, { config: { servers: [], prefixes: [
    { prefix: 'dsh_browser_', mode: 'blocked' },
    { prefix: 'dsh_browser_read_', mode: 'on-demand' },
  ], tools: [{ name: 'dsh_browser_open', mode: 'visible' }] } });
  for (const name of ['dsh_browser_open', 'dsh_browser_read_page', 'dsh_browser_delete']) f.ctx.tools.register(f.nativeTool(name));
  assert.ok(names(await f.assemble()).includes('dsh_browser_open'));
  assert.equal((await f.call('dsh_browser_delete', { input: 'no' })).isError, true);
  assert.equal((await f.call(SELECT, { action: 'add', names: ['dsh_browser_delete'] })).isError, true);
  assert.equal((await f.call(SELECT, { action: 'add', names: ['dsh_browser_read_page'] })).isError, false);
  f.agent.ctx.tools.restrict({ deny: ['dsh_browser_read_page', 'dsh_browser_open'] });
  assert.deepEqual(text(await f.call(SEARCH, { prefix: 'dsh_browser_' })).tools, []);
  assert.equal((await f.call('dsh_browser_read_page', { input: 'no' })).isError, true);
  assert.ok(!names(await f.assemble()).includes('dsh_browser_open'));
});

test('policy validation cannot hide discovery controls or admit ambiguous rules', () => {
  for (const config of [
    { prefixes: [{ prefix: 'search_', mode: 'blocked' }] },
    { tools: [{ name: SELECT, mode: 'blocked' }] },
    { prefixes: [{ prefix: '', mode: 'blocked' }] },
    { prefixes: [{ prefix: 'browser_', mode: 'maybe' }] },
    { tools: [{ name: 'x', mode: 'visible' }, { name: 'x', mode: 'blocked' }] },
  ]) assert.throws(() => resolveConfig(config));
});
