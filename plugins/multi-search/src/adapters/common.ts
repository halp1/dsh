import { WebError } from '@deepseek-ai/dsh-web';
import type { WebSearchSource } from '@deepseek-ai/dsh-web';

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function endpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Endpoint must be an HTTP or HTTPS URL without credentials.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Endpoint must be an HTTP or HTTPS URL without credentials.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Endpoint must be an HTTP or HTTPS URL without credentials, query, or fragment.');
  }
  return url.href.replace(/\/+$/u, '');
}

export function tidy(text: unknown, max = 600): string | undefined {
  if (typeof text !== 'string') return undefined;
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat ? (flat.length > max ? `${flat.slice(0, max - 1)}…` : flat) : undefined;
}

export function normalizeSources(results: unknown[], limit: number | undefined, snippetField: string): WebSearchSource[] {
  const seen = new Set<string>();
  const sources: WebSearchSource[] = [];
  for (const item of results) {
    if (!record(item) || typeof item.url !== 'string') continue;
    let url: URL;
    try { url = new URL(item.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
    seen.add(url.href);
    const title = tidy(item.title, 300);
    const snippet = tidy(item[snippetField] ?? item.snippet);
    const publishedAt = tidy(item.publishedDate, 100);
    sources.push({ url: url.href, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}), ...(publishedAt ? { publishedAt } : {}) });
  }
  return limit === undefined ? sources : sources.slice(0, Math.max(0, limit));
}

export function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WebError('Search request aborted', 'WEB_ABORTED');
}

/** Race the whole transport, including body decoding, even when a fetch implementation ignores signals. */
export async function withTimeout<T>(signal: AbortSignal | undefined, run: (combined: AbortSignal) => Promise<T>, timeoutMs = 15_000): Promise<T> {
  aborted(signal);
  const timerController = new AbortController();
  const combined = signal ? AbortSignal.any([signal, timerController.signal]) : timerController.signal;
  let rejectAbort: () => void = () => {};
  const cancellation = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(signal?.aborted
      ? new WebError('Search request aborted', 'WEB_ABORTED')
      : new WebError('Search provider timed out', 'WEB_PROVIDER_ERROR'));
    combined.addEventListener('abort', rejectAbort, { once: true });
  });
  const timer = setTimeout(() => timerController.abort(), timeoutMs);
  try {
    const result = await Promise.race([Promise.resolve().then(() => run(combined)), cancellation]);
    aborted(signal);
    return result;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener('abort', rejectAbort);
  }
}

/** Do not echo upstream bodies, queries, URLs, or arbitrary exception strings into logs/errors. */
export async function requestJson(provider: string, fetchImpl: typeof globalThis.fetch, url: string | URL, init: RequestInit): Promise<unknown> {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error' });
    if (!response.ok) throw new WebError(`${provider} returned HTTP ${response.status}`, 'WEB_PROVIDER_ERROR');
    return await response.json();
  } catch (error: unknown) {
    if (error instanceof WebError) throw error;
    throw new WebError(`${provider} request or JSON decoding failed`, 'WEB_PROVIDER_ERROR');
  }
}
