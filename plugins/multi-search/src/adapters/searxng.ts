import { WebError } from '@deepseek-ai/dsh-web';
import type { WebSearchResult } from '@deepseek-ai/dsh-web';
import type { SearchAdapter } from '../types.ts';
import { aborted, endpoint, normalizeSources, record, requestJson, tidy, withTimeout } from './common.ts';

export function mapSearxngResponse(body: unknown, limit?: number): WebSearchResult {
  if (!record(body) || body.error !== undefined || (!Array.isArray(body.results) && !Array.isArray(body.answers))) {
    throw new WebError('SearXNG returned an invalid search response', 'WEB_PROVIDER_ERROR');
  }
  if (body.results !== undefined && !Array.isArray(body.results)) throw new WebError('SearXNG results are malformed', 'WEB_PROVIDER_ERROR');
  if (body.answers !== undefined && !Array.isArray(body.answers)) throw new WebError('SearXNG answers are malformed', 'WEB_PROVIDER_ERROR');
  const results = Array.isArray(body.results) ? body.results : [];
  const sources = normalizeSources(results, undefined, 'content');
  const answers = (Array.isArray(body.answers) ? body.answers : [])
    .map(answer => tidy(typeof answer === 'string' ? answer : record(answer) ? answer.answer : undefined, 400))
    .filter((answer): answer is string => answer !== undefined);
  if (!sources.length && !answers.length && ((Array.isArray(body.unresponsive_engines) && body.unresponsive_engines.length) || results.length)) {
    throw new WebError('SearXNG returned no usable results because its engines failed or results were malformed', 'WEB_PROVIDER_ERROR');
  }
  const selected = limit === undefined ? sources : sources.slice(0, Math.max(0, limit));
  return { ...(answers.length ? { content: answers.join('\n') } : {}), sources: selected, truncated: selected.length < sources.length };
}

export const searxngAdapter: SearchAdapter = {
  id: 'searxng',
  name: 'SearXNG',
  description: 'Self-hostable metasearch engine aggregator.',
  fields: [{ key: 'baseURL', label: 'Instance URL', placeholder: 'https://searxng.example.com' }],
  defaultConfig: { baseURL: 'https://searxng.haelp.dev' },
  available(config) {
    try { endpoint(config.baseURL ?? this.defaultConfig.baseURL); return true; } catch { return false; }
  },
  async search(request, signal, config = {}, fetchImpl = globalThis.fetch) {
    aborted(signal);
    let baseURL: string;
    try { baseURL = endpoint(config.baseURL ?? this.defaultConfig.baseURL); }
    catch { throw new WebError('SearXNG endpoint is invalid', 'WEB_PROVIDER_ERROR'); }
    return withTimeout(signal, async combined => {
      const url = new URL(`${baseURL}/search`);
      url.searchParams.set('q', request.query);
      url.searchParams.set('format', 'json');
      const body = await requestJson('SearXNG', fetchImpl, url, {
        headers: { accept: 'application/json', 'user-agent': 'dsh-plugin-multi-search/0.1' },
        signal: combined,
      });
      return mapSearxngResponse(body, request.maxResults);
    });
  },
};
