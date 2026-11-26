import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Discovery } from '../src/index.js';
import { resolveConfig } from '../src/config.js';
import { SettingsConflictError, SettingsStore, SettingsValidationError, settingsHandler } from '../src/settings.js';
import { fixture } from './runtime.js';

function storage(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-discovery-settings-'));
  const file = join(directory, 'settings.json');
  t.after(() => {
    // This exact absolute directory was exclusively created for this test.
    assert.equal(resolve(directory), directory);
    assert.equal(directory.startsWith(join(tmpdir(), 'dsh-discovery-settings-')), true);
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, file };
}

test('settings persistence detects stale writers and preserves disk and runtime on invalid or failed writes', async (t) => {
  const { directory, file } = storage(t);
  const initial = resolveConfig();
  const first = new SettingsStore(file, initial);
  const second = new SettingsStore(file, initial);
  const next = { ...initial, tools: [{ name: 'bash', mode: 'blocked' }] };
  first.save(next, 0);
  assert.throws(() => second.save({ ...initial, servers: [] }, 0), SettingsConflictError);
  assert.deepEqual(second.snapshot().settings.tools, next.tools);
  const persisted = readFileSync(file, 'utf8');
  assert.throws(() => second.save({ ...next, prefixes: [{ prefix: 'search_', mode: 'blocked' }] }, 1), SettingsValidationError);
  assert.throws(() => second.save(next), SettingsValidationError);
  assert.throws(() => second.save({ ...next, settingsFile: '/not/allowed' }, 1), SettingsValidationError);
  assert.equal(readFileSync(file, 'utf8'), persisted);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), ['settings.json']);
  const { ctx } = await fixture(t);
  const discovery = new Discovery(ctx, initial);
  const unavailable = new SettingsStore(join(directory, 'missing', 'settings.json'), initial);
  writeFileSync(join(directory, 'missing'), 'not a directory');
  const handler = settingsHandler(unavailable, discovery, ctx.tools);
  const response = await handler(new Request('http://local.test', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: next, revision: 0 }),
  }));
  assert.equal(response.status, 500);
  assert.deepEqual(discovery.config, initial);
  writeFileSync(file, '{invalid');
  assert.throws(() => new SettingsStore(file, initial));
  assert.equal(readFileSync(file, 'utf8'), '{invalid');
});

test('settings route validates revisions and payloads then changes native presentation and execution without running tools', async (t) => {
  const { file } = storage(t);
  const f = await fixture(t, { config: { settingsFile: file } });
  const discovery = new Discovery(f.ctx, resolveConfig());
  const store = new SettingsStore(file, discovery.config);
  const handler = settingsHandler(store, discovery, f.ctx.tools);
  const get = await handler(new Request('http://local.test'));
  const before = await get.json();
  assert.equal(get.headers.get('cache-control'), 'no-store');
  assert.ok(before.tools.some(tool => tool.name === f.G));
  assert.ok(before.tools.every(tool => Object.keys(tool).every(key => ['name', 'description'].includes(key))));
  const settings = { ...before.settings, tools: [{ name: f.G, mode: 'blocked' }] };
  const request = (body, type = 'application/json') => new Request('http://local.test', {
    method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body),
  });
  assert.equal((await handler(request({ settings, revision: before.revision }))).status, 200);
  assert.equal(discovery.guard({ name: f.G, agent: f.agent }) !== undefined, true);
  assert.equal((await handler(request({ settings, revision: before.revision }))).status, 409);
  assert.equal((await handler(request({ settings, revision: 1 }, 'text/plain'))).status, 415);
  assert.equal((await handler(request({ settings: { servers: [] }, revision: 1 }))).status, 400);
  assert.equal((await handler(request({ settings: { ...settings, maxSelectedTools: 0 }, revision: 1 }))).status, 400);
  assert.equal((await handler(request({ settings, revision: 1, ignored: true }))).status, 400);
  assert.equal((await handler(request({ settings, revision: 1, padding: 'a'.repeat(65_536) }))).status, 413);
  assert.equal((await handler(new Request('http://local.test', { method: 'DELETE' }))).status, 405);
  assert.deepEqual(new SettingsStore(file, resolveConfig()).snapshot().settings.tools, settings.tools);
});

test('real Cordis injection owns settings route disposal and loads explicit persistent config before use', async (t) => {
  const { file } = storage(t);
  const store = new SettingsStore(file, resolveConfig());
  store.save({ ...resolveConfig(), tools: [{ name: 'bash', mode: 'blocked' }] }, 0);
  let route;
  let removed = 0;
  const f = await fixture(t, { config: { settingsFile: file }, setup(ctx) {
    ctx.provide('connection', { fetch: { register(value) { route = value; return () => { removed++; }; } } });
  } });
  assert.ok(route);
  assert.equal((await f.call('bash', { input: 'not executed' })).isError, true);
  const data = await (await route.fetch(new Request('http://local.test'))).json();
  assert.deepEqual(data.settings.tools, [{ name: 'bash', mode: 'blocked' }]);
  await f.plugin.dispose();
  assert.equal(removed, 1);
  assert.equal((await f.call('bash', { input: 'native execution restored' })).isError, false);
});
