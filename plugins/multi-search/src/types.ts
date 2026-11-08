import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';

export interface ProviderFieldDefinition {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password';
  description?: string;
}

/** An adapter owns its transport and field metadata. Secrets never enter client metadata. */
export interface SearchAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly fields: readonly ProviderFieldDefinition[];
  readonly defaultConfig: Record<string, string>;
  available(config: Record<string, string>): boolean;
  /** Report configured credentials without exposing their values to Settings. */
  hasApiKey?(config: Record<string, string>): boolean;
  search(
    request: WebSearchRequest,
    signal?: AbortSignal,
    config?: Record<string, string>,
    fetchImpl?: typeof globalThis.fetch,
  ): Promise<WebSearchResult>;
}

export interface ProviderSettingItem {
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
}

export interface MultiSearchSettings {
  providers: ProviderSettingItem[];
}

export interface PublicProviderSettingItem extends ProviderSettingItem {
  /** True when either a saved API key or the server environment can authenticate. */
  hasApiKey?: boolean;
}

export interface PublicMultiSearchSettings {
  providers: PublicProviderSettingItem[];
}
