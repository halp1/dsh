/**
 * dsh-plugin-background, browser half.
 *
 * Loads the shared library from the host, paints the chosen image on a stage
 * behind `#root`, turns the app's background tokens translucent, and adds a
 * Settings → Background tab to manage it all.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
// Type-only: pulls the settings slot declarations into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the theme runtime's Context merge (ctx.theme).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { createController, type Controller } from './controller.ts'
import { BackgroundTab, type BackgroundTabProps } from './settings-tab.tsx'
import { Stage } from './stage.ts'
import { createStateClient, type StateClient } from './state-client.ts'
import { injectTabStyles } from './styles.ts'
import { Transparency } from './transparency.ts'

/** The slice of the host slot registry this plugin uses (its types are not published). */
interface SlotRegistryLike {
  inject(key: string, setup: () => () => void): void
  register(
    options: { name: string; id: string; order?: number; label?: string | (() => string); inject?: () => object },
    component: ComponentType<never>,
  ): () => void
}

/** Stable Cordis plugin name. */
export const name = 'background'

/** `slots` for the Settings tab, `theme` for the token overrides. */
export const inject = ['slots', 'theme']

/** Settings nav position: after dshmarket (40), before subscriptions (90). */
export const TAB_ORDER = 50

/** Devtools handle. */
export const BACKGROUND_GLOBAL = '__dshBackground__'

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  if (typeof document === 'undefined') return
  const client: StateClient = createStateClient()
  const stage = new Stage(document)
  const transparency = new Transparency(document, ctx.theme)
  let controller: Controller | undefined

  ctx.effect(() => client.start(window), 'background: library polling')

  ctx.effect(() => {
    controller = createController({ client, stage, transparency })
    return () => {
      controller?.dispose()
      controller = undefined
    }
  }, 'background: stage controller')

  ctx.effect(() => injectTabStyles(document), 'background: settings tab styles')

  const slots = (ctx as unknown as { slots: SlotRegistryLike }).slots
  slots.inject('settings.section', () => slots.register({
    name: 'settings.section',
    id: 'background',
    order: TAB_ORDER,
    label: 'Background',
    inject: () => ({ client }),
  }, BackgroundTab as ComponentType<BackgroundTabProps> as ComponentType<never>))

  ctx.effect(() => {
    const target = window as unknown as Record<string, unknown>
    target[BACKGROUND_GLOBAL] = {
      get state() { return client.getSnapshot() },
      get current() { return controller?.current },
      refresh: () => client.refresh(),
    }
    return () => { delete target[BACKGROUND_GLOBAL] }
  }, 'background: devtools handle')
}
