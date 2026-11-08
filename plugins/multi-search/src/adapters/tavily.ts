import { WebError } from '@deepseek-ai/dsh-web';
import type { WebSearchResult } from '@deepseek-ai/dsh-web';
import type { SearchAdapter } from '../types.ts';
import { aborted, endpoint, normalizeSources, record, requestJson, withTimeout } from './common.ts';

export function tavilyApiKey(config: Record<string, string>): string {
  return config.apiKey || process.env.TAVILY_API_KEY || '';
}

export function mapTavilyResponse(body: unknown, limit?: number): WebSearchResult {
  if (!record(body) || body.error !== undefined || body.detail !== undefined || !Array.isArray(body.results)) {
    throw new WebError('Tavily returned an invalid search response', 'WEB_PROVIDER_ERROR');
  }
  const rows = body.results.map(item => record(item) ? { ...item, publishedDate: item.published_date } : item);
  const sources = normalizeSources(rows, undefined, 'content');
  if (body.results.length && !sources.length) throw new WebError('Tavily returned malformed search results', 'WEB_PROVIDER_ERROR');
  const selected = limit === undefined ? sources : sources.slice(0, Math.max(0, limit));
  return { sources: selected, truncated: selected.length < sources.length };
}

export const tavilyAdapter: SearchAdapter = {
  id: 'tavily',
  name: 'Tavily',
  description: 'Web search with relevant source snippets.',
  fields: [
    { key: 'apiKey', label: 'API key', placeholder: 'Enter a Tavily API key', type: 'password' },
    { key: 'baseURL', label: 'API endpoint', placeholder: 'https://api.tavily.com' },
  ],
  defaultConfig: { apiKey: '', baseURL: 'https://api.tavily.com' },
  hasApiKey(config) { return Boolean(tavilyApiKey(config)); },
  available(config) {
    try { endpoint(config.baseURL ?? this.defaultConfig.baseURL); return Boolean(tavilyApiKey(config)); } catch { return false; }
  },
  async search(request, signal, config = {}, fetchImpl = globalThis.fetch) {
    aborted(signal);
    const apiKey = tavilyApiKey(config);
    if (!apiKey || apiKey.length > 4096 || /[\s\p{Cc}\p{Cf}]/u.test(apiKey)) {
      throw new WebError('Tavily API key is not configured or is invalid', 'WEB_PROVIDER_ERROR');
    }
    let baseURL: string;
    try { baseURL = endpoint(config.baseURL ?? this.defaultConfig.baseURL); }
    catch { throw new WebError('Tavily endpoint is invalid', 'WEB_PROVIDER_ERROR'); }
    return withTimeout(signal, async combined => {
      const body = await requestJson('Tavily', fetchImpl, `${baseURL}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          query: request.query,
          max_results: Math.max(0, Math.min(request.maxResults ?? 10, 20)),
          search_depth: 'basic',
          auto_parameters: false,
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_published_date: true,
        }),
        signal: combined,
      });
      return mapTavilyResponse(body, request.maxResults);
    });
  },
};
