import type { Context } from '@deepseek-ai/cordis';
import { DiscoverySettingsTab } from './settings-tab.tsx';

export const name = 'mcp-discovery-settings';
export const inject = ['slots'];

export function apply(ctx: Context): void {
  const slots = (ctx as any).slots;
  if (!slots?.inject) return;
  ctx.effect(() => slots.inject('settings.section', () => slots.register({
    name: 'settings.section', id: 'mcp-discovery', order: 49, label: 'Tool Discovery',
  }, DiscoverySettingsTab)));
}
