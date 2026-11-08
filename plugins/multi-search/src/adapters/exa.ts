import { WebError } from '@deepseek-ai/dsh-web';
import type { WebSearchResult } from '@deepseek-ai/dsh-web';
import type { SearchAdapter } from '../types.ts';
import { aborted, endpoint, normalizeSources, record, requestJson, withTimeout } from './common.ts';

export function exaApiKey(config: Record<string, string>): string {
  return config.apiKey || process.env.EXA_API_KEY || '';
}

export function mapExaResponse(body: unknown, limit?: number): WebSearchResult {
  if (!record(body) || body.error !== undefined || !Array.isArray(body.results)) {
    throw new WebError('Exa returned an invalid search response', 'WEB_PROVIDER_ERROR');
  }
  const sources = normalizeSources(body.results, undefined, 'text');
  if (body.results.length && !sources.length) throw new WebError('Exa returned malformed search results', 'WEB_PROVIDER_ERROR');
  const selected = limit === undefined ? sources : sources.slice(0, Math.max(0, limit));
  return { sources: selected, truncated: selected.length < sources.length };
}

export const exaAdapter: SearchAdapter = {
  id: 'exa',
  name: 'Exa Search',
  description: 'Neural web search API with clean content extraction.',
  fields: [
    { key: 'apiKey', label: 'API key', placeholder: 'Enter an Exa API key', type: 'password' },
    { key: 'baseURL', label: 'API endpoint', placeholder: 'https://api.exa.ai' },
  ],
  defaultConfig: { apiKey: '', baseURL: 'https://api.exa.ai' },
  hasApiKey(config) { return Boolean(exaApiKey(config)); },
  available(config) {
    try { endpoint(config.baseURL ?? this.defaultConfig.baseURL); return Boolean(exaApiKey(config)); } catch { return false; }
  },
  async search(request, signal, config = {}, fetchImpl = globalThis.fetch) {
    aborted(signal);
    const apiKey = exaApiKey(config);
    if (!apiKey || apiKey.length > 4096 || /[\s\p{Cc}\p{Cf}]/u.test(apiKey)) {
      throw new WebError('Exa API key is not configured or is invalid', 'WEB_PROVIDER_ERROR');
    }
    let baseURL: string;
    try { baseURL = endpoint(config.baseURL ?? this.defaultConfig.baseURL); }
    catch { throw new WebError('Exa endpoint is invalid', 'WEB_PROVIDER_ERROR'); }
    return withTimeout(signal, async combined => {
      const body = await requestJson('Exa', fetchImpl, `${baseURL}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ query: request.query, numResults: Math.max(1, Math.min(request.maxResults ?? 10, 25)), contents: { text: { maxCharacters: 600 } } }),
        signal: combined,
      });
      return mapExaResponse(body, request.maxResults);
    });
  },
};
