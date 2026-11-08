import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { MultiSearchProvider, apply, settingsHandler } from '../src/index.ts';
import { SettingsStore, normalizeSettings, publicSettings } from '../src/settings-store.ts';
import { searxngAdapter, mapSearxngResponse } from '../src/adapters/searxng.ts';
import { exaAdapter, mapExaResponse } from '../src/adapters/exa.ts';
import { withTimeout } from '../src/adapters/common.ts';

function fixture(t, initial) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-multi-search-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.includes('dsh-multi-search-test-'));
    rmSync(directory, { recursive: true });
  });
  const file = join(directory, 'settings.json');
  return { directory, file, store: new SettingsStore(file, initial) };
}
const settings = (providers = ['searxng', 'exa']) => ({ providers: providers.map(id => ({ id, name: id, enabled: true, config: id === 'exa' ? { apiKey: 'fixture-secret', baseURL: 'https://exa.test' } : { baseURL: 'https://sx.test' } })) });
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const post = body => new Request('http://local.test/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('settings validation rejects unsafe endpoints, malformed configs and duplicate providers without losing explicit empty credentials', () => {
  const input = settings();
  for (const baseURL of ['file:///tmp/secret', 'ftp://host.test', 'https://user:secret@host.test', 'https://host.test?key=secret', 'https://host.test/#key', 'not-a-url', '']) {
    assert.throws(() => normalizeSettings({ providers: [{ id: 'searxng', config: { baseURL } }] }));
  }
  for (const bad of [null, { providers: null }, { providers: [null] }, { providers: [{ id: 'unknown' }] }, { providers: [input.providers[0], input.providers[0]] }, { providers: [{ id: 'exa', config: { apiKey: null } }] }, { providers: [{ id: 'exa', enabled: 'yes' }] }, { providers: [{ id: 'exa', config: { apiKey: 'line\nbreak' } }] }]) {
    assert.throws(() => normalizeSettings(bad));
  }
  const preserved = normalizeSettings({ providers: [{ id: 'exa', config: {} }] }, input);
  assert.equal(preserved.providers[0].config.apiKey, 'fixture-secret');
  assert.equal(normalizeSettings({ providers: [{ id: 'exa', config: { apiKey: '' } }] }, input).providers[0].config.apiKey, '');
});

test('private settings round trip atomically at mode 0600 and failed persistence leaves memory and revision unchanged', t => {
  const { store, directory, file } = fixture(t, settings());
  const original = store.get();
  original.providers[0].enabled = false;
  assert.equal(store.get().providers[0].enabled, true);
  store.save(settings(['exa', 'searxng']));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), ['settings.json']);
  assert.deepEqual(new SettingsStore(file).get(), store.get());
  assert.equal(new SettingsStore(file).revision, 1);
  assert.throws(() => store.save(settings(), 0));
  const committed = store.get();
  // Replacing the destination with a directory makes the atomic rename fail even as root.
  rmSync(file);
  mkdirSync(file);
  assert.throws(() => store.save(settings()));
  assert.deepEqual(store.get(), committed);
  assert.equal(store.revision, 1);
  assert.deepEqual(readdirSync(directory), ['settings.json']);
  const broken = join(directory, 'broken.json');
  writeFileSync(broken, '{invalid');
  assert.throws(() => new SettingsStore(broken));
  assert.equal(readFileSync(broken, 'utf8'), '{invalid');
});

test('authenticated settings handler redacts credentials and supports omission, rotation, explicit clear, conflicts and validation errors', async t => {
  const { store, file } = fixture(t, settings());
  const previousEnv = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  t.after(() => { if (previousEnv === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previousEnv; });
  const handler = settingsHandler(store);
  const read = await handler(new Request('http://local.test'));
  assert.equal(read.headers.get('cache-control'), 'no-store');
  const first = await read.json();
  assert.equal(JSON.stringify(first).includes('fixture-secret'), false);
  const exa = first.settings.providers.find(provider => provider.id === 'exa');
  assert.equal(Object.hasOwn(exa.config, 'apiKey'), false);
  assert.equal(exa.hasApiKey, true);
  let response = await handler(post({ settings: first.settings, revision: first.revision }));
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(await response.json()).includes('fixture-secret'), false);
  assert.equal(new SettingsStore(file).get().providers.find(provider => provider.id === 'exa').config.apiKey, 'fixture-secret');
  response = await handler(post({ settings: first.settings, revision: first.revision }));
  assert.equal(response.status, 409);
  exa.config.apiKey = 'rotated-fixture-key';
  response = await handler(post({ settings: first.settings, revision: store.revision }));
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(await response.json()).includes('rotated-fixture-key'), false);
  exa.config.apiKey = '';
  response = await handler(post({ settings: first.settings, revision: store.revision }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.providers.find(provider => provider.id === 'exa').hasApiKey, false);
  exa.config.baseURL = 'https://user:secret@bad.test';
  assert.equal((await handler(post({ settings: first.settings }))).status, 400);
  assert.equal((await handler(post({ settings: {} }))).status, 400);
  assert.equal((await handler(new Request('http://local.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal((await handler(new Request('http://local.test', { method: 'POST', body: '{}' }))).status, 415);
  rmSync(file);
  mkdirSync(file);
  assert.equal((await handler(post({ settings: settings() }))).status, 500);
});

test('boundary parsers reject error-shaped, malformed and unsafe rows but retain valid deduplicated citations and empty successes', () => {
  for (const map of [mapExaResponse, mapSearxngResponse]) {
    for (const body of [null, [], {}, { error: 'failure', results: [] }, { results: 'wrong' }, { results: [null, { url: 'javascript:evil()' }] }]) assert.throws(() => map(body));
    assert.deepEqual(map({ results: [] }), { sources: [], truncated: false });
    const result = map({ results: [null, { url: 'https://a.test/page', title: '  A  ', text: 'extracted', content: 'snippet' }, { url: 'https://a.test/page' }, { url: 'https://b.test/page' }] }, 1);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].title, 'A');
    assert.equal(result.truncated, true);
    assert.equal(map({ results: [{ url: 'https://a.test/page' }] }, 0).sources.length, 0);
  }
  assert.throws(() => mapSearxngResponse({ results: [], unresponsive_engines: [['google', 'CAPTCHA']] }));
  assert.equal(mapSearxngResponse({ answers: ['42'] }).content, '42');
});

test('search chain stops at success, follows updated order, falls back on HTTP/engine/JSON failures and skips disabled providers', async t => {
  const { store } = fixture(t, settings());
  const calls = [];
  let primary = () => json({ results: [{ url: 'https://first.test/page' }] });
  const fetchImpl = async url => {
    const origin = new URL(url).origin;
    calls.push(origin);
    return origin === 'https://sx.test' ? primary() : json({ results: [{ url: 'https://fallback.test/page' }] });
  };
  const provider = new MultiSearchProvider(store, 'multi-search', fetchImpl);
  assert.equal((await provider.search({ query: 'q' })).sources[0].url, 'https://first.test/page');
  assert.deepEqual(calls.splice(0), ['https://sx.test']);
  for (const fail of [() => new Response('rate limited', { status: 429 }), () => json({ results: [], unresponsive_engines: [['google', 'CAPTCHA']] }), () => json({ error: 'failure' }), () => new Response('<html>')]) {
    primary = fail;
    assert.equal((await provider.search({ query: 'q' })).sources[0].url, 'https://fallback.test/page');
    assert.deepEqual(calls.splice(0), ['https://sx.test', 'https://exa.test']);
  }
  store.save(settings(['exa', 'searxng']));
  await provider.search({ query: 'q' });
  assert.deepEqual(calls.splice(0), ['https://exa.test']);
  const disabled = settings();
  disabled.providers[0].enabled = false;
  store.save(disabled);
  await provider.search({ query: 'q' });
  assert.deepEqual(calls.splice(0), ['https://exa.test']);
});

test('caller cancellation and plugin disposal abort hanging or late transports without starting fallback', async t => {
  const { store } = fixture(t, settings());
  for (const phase of ['pre', 'fetch', 'body', 'dispose']) {
    let calls = 0;
    const controller = new AbortController();
    if (phase === 'pre') controller.abort();
    const provider = new MultiSearchProvider(store, 'multi-search', async () => {
      calls++;
      if (phase === 'body') return { ok: true, json: async () => new Promise(() => {}) };
      return new Promise(() => {});
    });
    const pending = provider.search({ query: 'q' }, controller.signal);
    await Promise.resolve();
    if (phase === 'dispose') provider.dispose();
    else controller.abort(new Error('private caller reason'));
    await assert.rejects(pending, error => error.code === 'WEB_ABORTED' && !error.message.includes('private caller reason'));
    assert.equal(calls, phase === 'pre' ? 0 : 1);
  }
  for (const adapter of [exaAdapter, searxngAdapter]) {
    await assert.rejects(adapter.search({ query: 'q' }, AbortSignal.abort(), {}, async () => { throw new Error('must not fetch'); }), error => error.code === 'WEB_ABORTED');
  }
  await assert.rejects(withTimeout(undefined, async () => new Promise(() => {}), 5), error => error.code === 'WEB_PROVIDER_ERROR');
});

test('Exa uses configured or server-environment credentials only and never echoes upstream bodies, credentials or request errors', async t => {
  const previousEnv = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  t.after(() => { if (previousEnv === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previousEnv; });
  assert.equal(exaAdapter.available({ apiKey: '' }), false);
  await assert.rejects(exaAdapter.search({ query: 'q' }, undefined, { apiKey: '' }), error => error.code === 'WEB_PROVIDER_ERROR');
  process.env.EXA_API_KEY = 'env-fixture-key';
  assert.equal(publicSettings(settings()).providers[1].hasApiKey, true);
  let received;
  await exaAdapter.search({ query: 'q', maxResults: 2 }, undefined, { apiKey: '' }, async (url, init) => {
    received = init;
    return json({ results: [] });
  });
  assert.equal(received.headers['x-api-key'], 'env-fixture-key');
  assert.equal(received.redirect, 'error');
  assert.equal(JSON.parse(received.body).numResults, 2);
  await assert.rejects(exaAdapter.search({ query: 'q' }, undefined, { apiKey: 'fixture-secret' }, async () => new Response('fixture-secret', { status: 401 })), error => !error.message.includes('fixture-secret'));
  await assert.rejects(exaAdapter.search({ query: 'q' }, undefined, { apiKey: 'fixture-secret' }, async () => { throw new Error('fixture-secret'); }), error => !error.message.includes('fixture-secret'));
});

test('host installation consumes raw config and disposes both provider aliases and the authenticated settings route', async t => {
  const { file } = fixture(t);
  const providers = [];
  const cleanups = [];
  let route;
  let removed = 0;
  const connection = { fetch: { register(value) { route = value; return () => { removed++; }; } } };
  const web = { registerSearchProvider(provider) { providers.push(provider); return () => { removed++; }; } };
  const ctx = {
    get(key) { return key === 'web' ? web : connection; },
    effect(setup) { cleanups.push(setup()); },
    inject(keys, setup) { setup(ctx); },
  };
  apply(ctx, { settingsFile: file, providers: settings(['exa', 'searxng']).providers });
  const snapshot = await (await route.fetch(new Request('http://local.test'))).json();
  assert.equal(snapshot.settings.providers[0].id, 'exa');
  assert.equal(snapshot.settings.providers[0].hasApiKey, true);
  assert.equal(JSON.stringify(snapshot).includes('fixture-secret'), false);
  assert.deepEqual(providers.map(provider => provider.id), ['multi-search', 'searxng']);
  for (const cleanup of cleanups) cleanup();
  assert.equal(removed, 3);
  assert.equal(providers.every(provider => !provider.available()), true);
});
