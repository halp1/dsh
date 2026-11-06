/**
 * dsh-plugin-searxng: a SearXNG-backed search provider for the `ctx.web`
 * capability seam.
 *
 * SearXNG is a self-hostable metasearch engine. It fans one query out to many
 * upstream engines, merges and de-duplicates the results, and can return them
 * as JSON, so there is no API key, no quota, and no per-query bill. This
 * provider turns that JSON into the seam's portable `WebSearchResult`.
 *
 * Requirements on the SearXNG side: `json` must be listed under
 * `search.formats` in its `settings.yml` (it is off by default), otherwise the
 * instance answers 403 and this provider says so.
 *
 * @module dsh-plugin-searxng
 */

import { WebError } from '@deepseek-ai/dsh-web';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng';

/** The web seam this provider registers into. */
export const inject = ['web'];

/** Stable id this provider registers under; `web.searchProvider` selects it. */
export const SEARXNG_PROVIDER_ID = 'searxng';

const DEFAULTS = Object.freeze({
  baseURL: process.env.SEARXNG_URL ?? 'http://localhost:8080',
  timeoutMs: 15_000,
  userAgent: 'dsh-plugin-searxng/0.1',
});

/** Cap on provider-supplied snippet text, so one verbose result cannot flood context. */
const MAX_SNIPPET_CHARS = 600;

/**
 * Validate and default the plugin config.
 * @param raw - the user's config section.
 * @returns the resolved, immutable config.
 */
export function resolveConfig(raw = {}) {
  const baseURL = String(raw.baseURL ?? DEFAULTS.baseURL).replace(/\/+$/u, '');
  if (!URL.canParse(baseURL) || !/^https?:/u.test(baseURL)) {
    throw new Error(`searxng: baseURL must be an http(s) URL, got ${JSON.stringify(baseURL)}`);
  }
  const timeoutMs = raw.timeoutMs ?? DEFAULTS.timeoutMs;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('searxng: timeoutMs must be a positive number');
  }
  const list = (key) => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
      throw new Error(`searxng: ${key} must be a list of non-empty strings`);
    }
    return Object.freeze([...value]);
  };
  const headers = raw.headers ?? {};
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
    throw new Error('searxng: headers must be a map of header name to value');
  }
  return Object.freeze({
    baseURL,
    timeoutMs,
    categories: list('categories'),
    engines: list('engines'),
    language: raw.language,
    safeSearch: raw.safeSearch,
    timeRange: raw.timeRange,
    userAgent: raw.userAgent ?? DEFAULTS.userAgent,
    headers: Object.freeze({ ...headers }),
  });
}

/** Collapse whitespace and cap length. */
function tidy(text, max = MAX_SNIPPET_CHARS) {
  if (typeof text !== 'string') return undefined;
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat === '') return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Map a SearXNG JSON body to a normalized search result: de-duplicated by URL,
 * best-ranked first (SearXNG already orders by merged score).
 * @param body - the parsed `/search?format=json` body.
 * @param limit - optional cap on sources, applied before the seam's own cap.
 * @returns the normalized result.
 * @throws {@link WebError} when nothing came back and engines reported failure.
 */
export function mapSearxngResponse(body, limit) {
  const results = Array.isArray(body?.results) ? body.results : [];
  const seen = new Set();
  const sources = [];
  for (const item of results) {
    const url = typeof item?.url === 'string' ? item.url : '';
    if (url === '' || seen.has(url)) continue;
    seen.add(url);
    const title = tidy(item.title, 300);
    const snippet = tidy(item.content);
    const publishedAt = typeof item.publishedDate === 'string' && item.publishedDate !== '' ? item.publishedDate : undefined;
    sources.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
    });
    if (limit !== undefined && sources.length >= limit) break;
  }

  // Direct answers (calculators, unit conversions, etc.) are real signal.
  const answers = (Array.isArray(body?.answers) ? body.answers : [])
    .map((answer) => tidy(typeof answer === 'string' ? answer : answer?.answer, 400))
    .filter((answer) => answer !== undefined);

  if (sources.length === 0 && answers.length === 0) {
    const failed = Array.isArray(body?.unresponsive_engines) ? body.unresponsive_engines : [];
    if (failed.length > 0) {
      const detail = failed.map((entry) => (Array.isArray(entry) ? entry.join(': ') : String(entry))).join('; ');
      throw new WebError(
        `SearXNG returned no results and these engines did not respond: ${detail}. ` +
          'The instance is likely being rate-limited by its upstream engines; retrying later may help.',
        'WEB_PROVIDER_ERROR',
      );
    }
  }

  return {
    ...(answers.length > 0 ? { content: answers.join('\n') } : {}),
    sources,
    truncated: false,
  };
}

/** True for a fetch/`AbortSignal` abort. */
function isAbortError(error) {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** The SearXNG-backed search provider. */
export class SearxngSearchProvider {
  id = SEARXNG_PROVIDER_ID;

  /**
   * @param resolveOptions - thunk returning the resolved config for the NEXT
   * search, so a settings change applies without re-registering the provider.
   * @param fetchImpl - fetch implementation, injectable for tests.
   */
  constructor(resolveOptions, fetchImpl = globalThis.fetch) {
    this.resolveOptions = resolveOptions;
    this.fetchImpl = fetchImpl;
  }

  /** Cheap local check; never touches the network. */
  available() {
    return URL.canParse(this.resolveOptions().baseURL);
  }

  async search(request, signal) {
    const options = this.resolveOptions();
    if (signal?.aborted === true) {
      throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: signal.reason });
    }

    const url = new URL(`${options.baseURL}/search`);
    url.searchParams.set('q', request.query);
    url.searchParams.set('format', 'json');
    if (options.categories !== undefined) url.searchParams.set('categories', options.categories.join(','));
    if (options.engines !== undefined) url.searchParams.set('engines', options.engines.join(','));
    if (options.language !== undefined) url.searchParams.set('language', String(options.language));
    if (options.safeSearch !== undefined) url.searchParams.set('safesearch', String(options.safeSearch));
    if (options.timeRange !== undefined) url.searchParams.set('time_range', String(options.timeRange));

    const timeout = AbortSignal.timeout(options.timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    let response;
    try {
      response = await this.fetchImpl(url, {
        redirect: 'error',
        headers: { accept: 'application/json', 'user-agent': options.userAgent, ...options.headers },
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted === true) {
        throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: signal.reason });
      }
      if (isAbortError(error) || timeout.aborted) {
        throw new WebError(`SearXNG search timed out after ${options.timeoutMs}ms (${options.baseURL})`, 'WEB_PROVIDER_ERROR', { cause: error });
      }
      throw new WebError(`SearXNG request to ${options.baseURL} failed: ${String(error?.cause?.message ?? error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
    }

    if (!response.ok) {
      let hint = '';
      if (response.status === 403) {
        hint = ' The instance refused the request; make sure "json" is listed under search.formats in its settings.yml.';
      } else if (response.status === 429) {
        hint = ' The instance is rate limiting this client (its limiter/bot detection); allow this address or disable the limiter.';
      }
      throw new WebError(`SearXNG returned HTTP ${response.status} for ${options.baseURL}.${hint}`, 'WEB_PROVIDER_ERROR');
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      if (signal?.aborted === true) {
        throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: signal.reason });
      }
      throw new WebError(
        `SearXNG at ${options.baseURL} did not return JSON; check that "json" is enabled under search.formats.`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      );
    }
    return mapSearxngResponse(body, request.maxResults);
  }
}

/**
 * Register the SearXNG provider with `ctx.web`.
 * @param ctx - the plugin context.
 * @param rawConfig - the user's config section.
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  ctx.web.registerSearchProvider(new SearxngSearchProvider(() => config));
  ctx.logger?.(name)?.info?.(`searxng: search provider registered (${config.baseURL})`);
}
