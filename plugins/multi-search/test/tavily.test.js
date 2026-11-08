import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { MultiSearchProvider, settingsHandler } from '../src/index.ts';
import { SettingsStore } from '../src/settings-store.ts';
import { tavilyAdapter, mapTavilyResponse } from '../src/adapters/tavily.ts';

const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const fixtureKey = 'tavily-fixture-secret';
const tavily = { id: 'tavily', name: 'Tavily', enabled: true, config: { apiKey: fixtureKey, baseURL: 'https://api.tavily.com' } };

function temporaryStore(t, initial) {
  const dir = mkdtempSync(join(tmpdir(), 'multi-search-tavily-'));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(dir.includes('multi-search-tavily-'));
    rmSync(dir, { recursive: true });
  });
  const file = join(dir, 'settings.json');
  return { file, store: new SettingsStore(file, initial) };
}

test('Tavily sends bounded basic search requests and maps published dates and snippets without raw content', async t => {
  const previous = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previous; });
  assert.equal(tavilyAdapter.available({}), false);
  await assert.rejects(tavilyAdapter.search({ query: 'q' }), error => error.code === 'WEB_PROVIDER_ERROR');
  const seen = [];
  for (const [limit, expected] of [[undefined, 10], [50, 20], [0, 0], [1, 1]]) {
    const result = await tavilyAdapter.search({ query: 'weather & climate', maxResults: limit }, undefined, tavily.config, async (url, init) => {
      seen.push({ url, init });
      assert.equal(url, 'https://api.tavily.com/search');
      assert.equal(init.headers.authorization, `Bearer ${fixtureKey}`);
      assert.equal(init.redirect, 'error');
      assert.equal(init.method, 'POST');
      const body = JSON.parse(init.body);
      assert.equal(body.query, 'weather & climate');
      assert.equal(body.max_results, expected);
      assert.equal(body.search_depth, 'basic');
      assert.equal(body.auto_parameters, false);
      assert.equal(body.include_answer, false);
      assert.equal(body.include_raw_content, false);
      assert.equal(body.include_images, false);
      assert.equal(JSON.stringify(body).includes(fixtureKey), false);
      return json({ results: [
        { title: '  Source  ', url: 'https://source.test/page', content: '  useful\n snippet ', published_date: 'Tue, 11 Mar 2025 17:00:00 GMT', raw_content: 'raw text must not be used' },
        { url: 'https://source.test/page', content: 'duplicate' },
        { url: 'https://second.test/page', content: 'x'.repeat(3000) },
      ] });
    });
    assert.equal(result.sources.length, limit === 0 ? 0 : limit === 1 ? 1 : 2);
    if (limit !== 0) {
      assert.equal(result.sources[0].snippet, 'useful snippet');
      assert.equal(result.sources[0].publishedAt, 'Tue, 11 Mar 2025 17:00:00 GMT');
      assert.equal(result.sources[0].title, 'Source');
    }
    assert.equal(JSON.stringify(result).includes('raw text must not be used'), false);
  }
  process.env.TAVILY_API_KEY = 'env-tavily-fixture';
  await tavilyAdapter.search({ query: 'q' }, undefined, {}, async (_url, init) => {
    assert.equal(init.headers.authorization, 'Bearer env-tavily-fixture');
    return json({ results: [] });
  });
  for (const fetchImpl of [async () => new Response(fixtureKey, { status: 401 }), async () => { throw new Error(fixtureKey); }]) {
    await assert.rejects(tavilyAdapter.search({ query: 'q' }, undefined, tavily.config, fetchImpl), error => error.code === 'WEB_PROVIDER_ERROR' && !error.message.includes(fixtureKey));
  }
  assert.throws(() => mapTavilyResponse({ detail: { error: fixtureKey }, results: [] }));
});

test('saved two-provider chains gain disabled Tavily, then persist it after Exa with redacted credential management', async t => {
  const initial = { providers: [
    { id: 'searxng', enabled: true, config: { baseURL: 'https://sx.test' } },
    { id: 'exa', enabled: true, config: { baseURL: 'https://exa.test', apiKey: 'exa-fixture' } },
  ] };
  const { file, store } = temporaryStore(t, initial);
  assert.deepEqual(store.get().providers.map(p => [p.id, p.enabled]), [['searxng', true], ['exa', true], ['tavily', false]]);
  const next = store.get();
  next.providers[2] = tavily;
  store.save(next);
  assert.deepEqual(new SettingsStore(file).get().providers.map(p => p.id), ['searxng', 'exa', 'tavily']);
  const handler = settingsHandler(store);
  const first = await (await handler(new Request('http://local.test'))).json();
  const publicTavily = first.settings.providers.find(p => p.id === 'tavily');
  assert.equal(publicTavily.hasApiKey, true);
  assert.equal(Object.hasOwn(publicTavily.config, 'apiKey'), false);
  assert.equal(JSON.stringify(first).includes(fixtureKey), false);
  const save = () => handler(new Request('http://local.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: first.settings, revision: store.revision }) }));
  assert.equal((await save()).status, 200);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).providers[2].config.apiKey, fixtureKey);
  publicTavily.config.apiKey = '';
  assert.equal((await save()).status, 200);
  assert.equal(store.get().providers[2].config.apiKey, '');
  // Restore the fixture key before exercising the full chain.
  store.save(next);
  const calls = [];
  let exaSucceeds = false;
  const provider = new MultiSearchProvider(store, 'multi-search', async url => {
    const host = new URL(url).hostname;
    calls.push(host);
    if (host === 'sx.test') return new Response('limited', { status: 429 });
    if (host === 'exa.test' && !exaSucceeds) return new Response('down', { status: 503 });
    return json({ results: [{ url: 'https://result.test/page', content: 'tavily snippet', text: 'exa snippet' }] });
  });
  assert.equal((await provider.search({ query: 'q' })).sources[0].snippet, 'tavily snippet');
  assert.deepEqual(calls.splice(0), ['sx.test', 'exa.test', 'api.tavily.com']);
  exaSucceeds = true;
  assert.equal((await provider.search({ query: 'q' })).sources[0].snippet, 'exa snippet');
  assert.deepEqual(calls, ['sx.test', 'exa.test']);
});
