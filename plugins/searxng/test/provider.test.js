import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WebError } from '@deepseek-ai/dsh-web';

import { SearxngSearchProvider, apply, mapSearxngResponse, resolveConfig } from '../src/index.js';

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

const provider = (fetchImpl, raw = {}) => new SearxngSearchProvider(() => resolveConfig({ baseURL: 'https://sx.test/', ...raw }), fetchImpl);

describe('resolveConfig', () => {
  it('strips trailing slashes and rejects non-http URLs', () => {
    assert.equal(resolveConfig({ baseURL: 'https://sx.test///' }).baseURL, 'https://sx.test');
    assert.throws(() => resolveConfig({ baseURL: 'ftp://x' }), /http\(s\)/);
    assert.throws(() => resolveConfig({ baseURL: 'nope' }), /http\(s\)/);
  });
  it('validates timeout and lists', () => {
    assert.throws(() => resolveConfig({ timeoutMs: 0 }), /timeoutMs/);
    assert.throws(() => resolveConfig({ categories: 'general' }), /categories/);
    assert.deepEqual([...resolveConfig({ engines: ['google'] }).engines], ['google']);
  });
});

describe('mapSearxngResponse', () => {
  it('maps, dedupes by url, drops url-less rows and respects the limit', () => {
    const out = mapSearxngResponse(
      {
        results: [
          { url: 'https://a.test', title: 'A', content: '  hello \n world ', publishedDate: '2025-01-02T00:00:00' },
          { url: 'https://a.test', title: 'dup' },
          { title: 'no url' },
          { url: 'https://b.test', title: 'B' },
          { url: 'https://c.test', title: 'C' },
        ],
      },
      2,
    );
    assert.deepEqual(out.sources, [
      { url: 'https://a.test', title: 'A', snippet: 'hello world', publishedAt: '2025-01-02T00:00:00' },
      { url: 'https://b.test', title: 'B' },
    ]);
    assert.equal(out.truncated, false);
  });
  it('surfaces instant answers as content', () => {
    const out = mapSearxngResponse({ results: [], answers: ['42', { answer: 'also 42' }] });
    assert.equal(out.content, '42\nalso 42');
  });
  it('returns an empty result when there is simply nothing', () => {
    assert.deepEqual(mapSearxngResponse({ results: [] }), { sources: [], truncated: false });
  });
  it('reports a WebError when nothing came back because engines failed', () => {
    assert.throws(
      () => mapSearxngResponse({ results: [], unresponsive_engines: [['google', 'CAPTCHA'], ['bing', 'timeout']] }),
      (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_ERROR' && /google: CAPTCHA; bing: timeout/.test(e.message),
    );
  });
  it('truncates very long snippets', () => {
    const out = mapSearxngResponse({ results: [{ url: 'https://a.test', content: 'x'.repeat(5000) }] });
    assert.ok(out.sources[0].snippet.length <= 600);
  });
});

describe('SearxngSearchProvider', () => {
  it('builds the request URL and sends JSON accept', async () => {
    let seen;
    const p = provider(async (url, init) => {
      seen = { url: new URL(url), init };
      return json({ results: [{ url: 'https://a.test', title: 'A' }] });
    }, { categories: ['general'], language: 'en', timeRange: 'month' });
    const out = await p.search({ query: 'node js & more' });
    assert.equal(seen.url.origin + seen.url.pathname, 'https://sx.test/search');
    assert.equal(seen.url.searchParams.get('q'), 'node js & more');
    assert.equal(seen.url.searchParams.get('format'), 'json');
    assert.equal(seen.url.searchParams.get('categories'), 'general');
    assert.equal(seen.url.searchParams.get('language'), 'en');
    assert.equal(seen.url.searchParams.get('time_range'), 'month');
    assert.equal(seen.init.headers.accept, 'application/json');
    assert.equal(seen.init.redirect, 'error');
    assert.equal(out.sources.length, 1);
  });

  it('explains a 403 as json-not-enabled and a 429 as rate limiting', async () => {
    await assert.rejects(provider(async () => new Response('no', { status: 403 })).search({ query: 'q' }), /search\.formats/);
    await assert.rejects(provider(async () => new Response('no', { status: 429 })).search({ query: 'q' }), /rate limiting/);
  });

  it('reports non-JSON bodies', async () => {
    await assert.rejects(
      provider(async () => new Response('<html>', { status: 200 })).search({ query: 'q' }),
      (e) => e instanceof WebError && /did not return JSON/.test(e.message),
    );
  });

  it('wraps network failures', async () => {
    await assert.rejects(
      provider(async () => { throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }); }).search({ query: 'q' }),
      (e) => e instanceof WebError && /ECONNREFUSED/.test(e.message),
    );
  });

  it('maps caller aborts to WEB_ABORTED, before and during the request', async () => {
    const pre = AbortSignal.abort('stop');
    await assert.rejects(provider(async () => json({})).search({ query: 'q' }, pre), (e) => e.code === 'WEB_ABORTED');

    const ac = new AbortController();
    const p = provider((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
    }));
    const pending = p.search({ query: 'q' }, ac.signal);
    ac.abort('user');
    await assert.rejects(pending, (e) => e.code === 'WEB_ABORTED');
  });

  it('times out slow instances', async () => {
    const p = provider((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('t', 'TimeoutError')));
    }), { timeoutMs: 20 });
    await assert.rejects(p.search({ query: 'q' }), (e) => e.code === 'WEB_PROVIDER_ERROR' && /timed out/.test(e.message));
  });

  it('is available whenever the base URL parses, without network', () => {
    assert.equal(provider(async () => { throw new Error('no network'); }).available(), true);
  });
});

describe('apply', () => {
  it('registers a provider under the id the seam selects', () => {
    const registered = [];
    apply({ web: { registerSearchProvider: (p) => registered.push(p) } }, { baseURL: 'https://sx.test' });
    assert.equal(registered.length, 1);
    assert.equal(registered[0].id, 'searxng');
  });
});
