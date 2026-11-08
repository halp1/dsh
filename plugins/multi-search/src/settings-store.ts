import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { MultiSearchSettings, ProviderSettingItem, PublicMultiSearchSettings } from './types.ts';
import { BUILTIN_ADAPTERS } from './adapters/index.ts';
import { endpoint, record } from './adapters/common.ts';

export const SETTINGS_API_PATH = '/api/dsh-multi-search.settings';
export const DEFAULT_SETTINGS: MultiSearchSettings = {
  providers: BUILTIN_ADAPTERS.map(adapter => ({ id: adapter.id, name: adapter.name, enabled: true, config: { ...adapter.defaultConfig } })),
};

export class SettingsValidationError extends Error {}
export class SettingsConflictError extends Error {}

export function defaultSettingsFilePath(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugins', 'multi-search', 'settings.json');
}

/** Omitted credentials preserve the previous value. An explicit empty string clears the saved key. */
export function normalizeSettings(raw: unknown, previous?: MultiSearchSettings): MultiSearchSettings {
  if (!record(raw)) throw new SettingsValidationError('Expected a settings object.');
  const list = raw.providers === undefined ? DEFAULT_SETTINGS.providers : raw.providers;
  if (!Array.isArray(list) || list.length > 32) throw new SettingsValidationError('Expected a provider list.');
  const providers: ProviderSettingItem[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!record(item) || typeof item.id !== 'string') throw new SettingsValidationError('Invalid provider.');
    const adapter = BUILTIN_ADAPTERS.find(candidate => candidate.id === item.id);
    if (!adapter || seen.has(adapter.id)) throw new SettingsValidationError('Unknown or duplicate provider.');
    seen.add(adapter.id);
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new SettingsValidationError('Provider enabled must be boolean.');
    if (item.name !== undefined && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128 || /[\p{Cc}\p{Cf}]/u.test(item.name))) {
      throw new SettingsValidationError('Provider name is invalid.');
    }
    if (item.config !== undefined && !record(item.config)) throw new SettingsValidationError('Provider config must be an object.');
    const supplied = item.config ?? {};
    const prior = previous?.providers.find(candidate => candidate.id === adapter.id);
    const config: Record<string, string> = {};
    for (const key of Object.keys(supplied)) {
      if (!adapter.fields.some(field => field.key === key)) throw new SettingsValidationError('Unknown provider config field.');
    }
    for (const field of adapter.fields) {
      const value = supplied[field.key] ?? prior?.config[field.key] ?? adapter.defaultConfig[field.key] ?? '';
      if (typeof value !== 'string' || value.length > 4096) throw new SettingsValidationError('Provider config field must be a bounded string.');
      if (Object.hasOwn(supplied, field.key) && supplied[field.key] === null) throw new SettingsValidationError('Provider config field must be a string.');
      if (field.type === 'password') {
        if (/[\s\p{Cc}\p{Cf}]/u.test(value)) throw new SettingsValidationError('API key must not contain whitespace or control characters.');
        config[field.key] = value;
      } else if (field.key === 'baseURL') {
        try { config[field.key] = endpoint(value); }
        catch { throw new SettingsValidationError('Endpoint must use HTTP or HTTPS without credentials, query, or fragment.'); }
      } else {
        config[field.key] = value;
      }
    }
    providers.push({ id: adapter.id, name: (item.name as string | undefined) ?? adapter.name, enabled: item.enabled as boolean | undefined ?? true, config });
  }
  for (const adapter of BUILTIN_ADAPTERS) {
    if (!seen.has(adapter.id)) providers.push({ id: adapter.id, name: adapter.name, enabled: false, config: { ...adapter.defaultConfig } });
  }
  return { providers };
}

export function publicSettings(settings: MultiSearchSettings): PublicMultiSearchSettings {
  return {
    providers: settings.providers.map(provider => {
      const config = { ...provider.config };
      const adapter = BUILTIN_ADAPTERS.find(adapter => adapter.id === provider.id);
      const fields = adapter?.fields ?? [];
      for (const field of fields) if (field.type === 'password') delete config[field.key];
      return {
        ...provider,
        config,
        ...(fields.some(field => field.type === 'password')
          ? { hasApiKey: adapter?.hasApiKey?.(provider.config) ?? fields.some(field => field.type === 'password' && Boolean(provider.config[field.key])) }
          : {}),
      };
    }),
  };
}

/** Owns persistence. Failed reads/writes never silently replace a user's private settings. */
export class SettingsStore {
  private filePath: string;
  private currentSettings: MultiSearchSettings;
  private currentRevision = 0;
  private listeners = new Set<(settings: MultiSearchSettings) => void>();

  constructor(filePath = defaultSettingsFilePath(), initial: unknown = DEFAULT_SETTINGS) {
    this.filePath = resolve(filePath);
    this.currentSettings = this.load(normalizeSettings(initial));
  }

  get revision(): number { return this.currentRevision; }
  get(): MultiSearchSettings { return structuredClone(this.currentSettings); }
  subscribe(listener: (settings: MultiSearchSettings) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private load(initial: MultiSearchSettings): MultiSearchSettings {
    let text: string;
    try { text = readFileSync(this.filePath, 'utf-8'); }
    catch (error: unknown) {
      if (record(error) && error.code === 'ENOENT') return initial;
      throw new Error('Cannot read Multi-Search settings.');
    }
    try {
      const raw: unknown = JSON.parse(text);
      const result = normalizeSettings(raw);
      if (record(raw) && Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0) this.currentRevision = Number(raw.revision);
      return result;
    } catch { throw new Error('Multi-Search settings are invalid. Repair the private settings file before continuing.'); }
  }

  save(settings: unknown, expectedRevision?: number): void {
    if (expectedRevision !== undefined && expectedRevision !== this.currentRevision) throw new SettingsConflictError('Settings changed. Reload before saving.');
    const normalized = normalizeSettings(settings, this.currentSettings);
    const revision = this.currentRevision + 1;
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.multi-search-${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    let created = false;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      created = true;
      writeFileSync(descriptor, JSON.stringify({ ...normalized, revision }, null, 2) + '\n', 'utf-8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, this.filePath);
      created = false;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      // Only this store's exclusively created, absolute same-directory temporary file is removed.
      if (created && dirname(temporary) === directory) unlinkSync(temporary);
    }
    this.currentSettings = normalized;
    this.currentRevision = revision;
    for (const listener of this.listeners) {
      try { listener(this.get()); } catch { /* Observers cannot undo a committed write. */ }
    }
  }
}
