import type { Context } from '@deepseek-ai/cordis';
import { WebError } from '@deepseek-ai/dsh-web';
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
import { BUILTIN_ADAPTERS, getAdapter } from './adapters/index.ts';
import { record, aborted } from './adapters/common.ts';
import { SettingsStore, SETTINGS_API_PATH, SettingsValidationError, SettingsConflictError, publicSettings, defaultSettingsFilePath } from './settings-store.ts';

export const name = 'dsh-plugin-multi-search';
export const inject = ['web'];
export { BUILTIN_ADAPTERS, getAdapter } from './adapters/index.ts';
export { SettingsStore, DEFAULT_SETTINGS, SETTINGS_API_PATH } from './settings-store.ts';
export type { SearchAdapter, MultiSearchSettings, ProviderSettingItem, ProviderFieldDefinition } from './types.ts';

type Logger = { warn(msg: string): void; info(msg: string): void };

export class MultiSearchProvider implements WebSearchProvider {
  readonly id: string;
  private store: SettingsStore;
  private fetchImpl: typeof globalThis.fetch;
  private logger: Logger | undefined;
  private lifetime = new AbortController();

  constructor(store: SettingsStore, id = 'multi-search', fetchImpl = globalThis.fetch, logger?: Logger) {
    this.store = store;
    this.id = id;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  dispose(): void { this.lifetime.abort(); }
  available(): boolean {
    return !this.lifetime.signal.aborted && this.store.get().providers.some(provider => provider.enabled && getAdapter(provider.id)?.available(provider.config));
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const combined = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    aborted(combined);
    const providers = this.store.get().providers.filter(provider => provider.enabled);
    if (!providers.length) throw new WebError('No search providers are enabled.', 'WEB_PROVIDER_ERROR');
    const failures: string[] = [];
    for (const provider of providers) {
      aborted(combined);
      const adapter = getAdapter(provider.id);
      if (!adapter) continue;
      try {
        const result = await adapter.search(request, combined, provider.config, this.fetchImpl);
        aborted(combined);
        return result;
      } catch (error: unknown) {
        aborted(combined);
        if (error instanceof WebError && error.code === 'WEB_ABORTED') throw error;
        const detail = error instanceof WebError ? error.message : 'request failed';
        failures.push(`${provider.id}: ${detail}`);
        this.logger?.warn(`[multi-search] ${provider.id} failed. Trying the next provider.`);
      }
    }
    throw new WebError(`All search providers failed. ${failures.join(' | ')}`, 'WEB_PROVIDER_ERROR');
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Register only through connection.fetch so host authentication and trust checks precede this handler. */
export function settingsHandler(store: SettingsStore): (request: Request) => Promise<Response> {
  const snapshot = () => ({
    settings: publicSettings(store.get()),
    revision: store.revision,
    adapters: BUILTIN_ADAPTERS.map(adapter => ({ id: adapter.id, name: adapter.name, description: adapter.description, fields: adapter.fields, defaultConfig: adapter.defaultConfig })),
  });
  return async request => {
    if (request.method === 'GET') return json(snapshot());
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Expected application/json.' }, 415);
    let body: unknown;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text) > 65_536) return json({ error: 'Settings payload is too large.' }, 413);
      body = JSON.parse(text);
    } catch { return json({ error: 'Expected valid JSON.' }, 400); }
    if (!record(body) || !record(body.settings) || !Array.isArray(body.settings.providers)) return json({ error: 'Expected { settings: { providers } }.' }, 400);
    if (body.revision !== undefined && (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0)) return json({ error: 'Invalid settings revision.' }, 400);
    try {
      store.save(body.settings, body.revision as number | undefined);
      return json({ ok: true, ...snapshot() });
    } catch (error: unknown) {
      if (error instanceof SettingsConflictError) return json({ error: error.message, ...snapshot() }, 409);
      if (error instanceof SettingsValidationError) return json({ error: error.message }, 400);
      return json({ error: 'Could not persist settings. No changes were applied.' }, 500);
    }
  };
}

export function apply(ctx: Context, rawConfig: Record<string, unknown> = {}): void {
  const path = rawConfig.settingsFile ?? rawConfig.stateFile ?? defaultSettingsFilePath();
  if (typeof path !== 'string' || !path.trim()) throw new SettingsValidationError('settingsFile must be a nonempty path.');
  const store = new SettingsStore(path, rawConfig.providers === undefined ? {} : { providers: rawConfig.providers });
  const logger = (ctx as Context & { logger?: (name: string) => Logger }).logger?.(name);
  const web = ctx.get('web') as { registerSearchProvider(provider: WebSearchProvider): () => void };
  for (const id of ['multi-search', 'searxng']) {
    const provider = new MultiSearchProvider(store, id, globalThis.fetch, logger);
    ctx.effect(() => {
      const dispose = web.registerSearchProvider(provider);
      return () => { provider.dispose(); dispose(); };
    });
  }
  ctx.inject(['connection'], connCtx => {
    const connection = connCtx.get('connection') as { fetch: { register(route: unknown): () => void } };
    connCtx.effect(() => connection.fetch.register({ path: SETTINGS_API_PATH, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: settingsHandler(store) }));
  });
}
