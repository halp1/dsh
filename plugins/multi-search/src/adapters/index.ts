import type { SearchAdapter } from '../types.ts';
import { searxngAdapter } from './searxng.ts';
import { exaAdapter } from './exa.ts';
import { tavilyAdapter } from './tavily.ts';

export const BUILTIN_ADAPTERS: SearchAdapter[] = [
  searxngAdapter,
  exaAdapter,
  tavilyAdapter,
];

export function getAdapter(id: string): SearchAdapter | undefined {
  return BUILTIN_ADAPTERS.find(adapter => adapter.id === id);
}

export function getAllAdapters(): readonly SearchAdapter[] {
  return BUILTIN_ADAPTERS;
}
