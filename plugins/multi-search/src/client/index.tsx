import type { Context } from '@deepseek-ai/cordis';
import { MultiSearchSettingsTab } from './settings-tab.tsx';

export const name = 'multi-search-settings';
export const inject = ['slots'];

export function apply(ctx: Context): void {
  const slots = (ctx as any).slots;
  if (!slots?.inject) return;

  ctx.effect(() => slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: 'multi-search',
        order: 48,
        label: 'Multi-Search',
      },
      MultiSearchSettingsTab,
    ),
  ));
}
