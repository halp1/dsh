/**
 * dsh-plugin-schedule-send, browser half.
 *
 * Registers an invisible anchor in the composer's trailing toolbar that turns
 * shift click and right click on Send into a schedule popover, and a dock
 * entry above the composer listing this Session's pending messages.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import { QueueHub, createApi } from './api.ts'
import { PendingDock, SendAnchor } from './Composer.tsx'
import { injectStyles } from './styles.ts'

/** The slice of the host slot registry this plugin uses. */
interface SlotRegistryLike {
  inject(key: string, setup: () => () => void): void
  register(
    options: { name: string; id: string; order?: number; inject?: (sessionId?: string) => object },
    component: ComponentType<never>,
  ): () => void
}

export const name = 'schedule-send'
export const inject = ['slots']

export function apply(ctx: Context): void {
  if (typeof document === 'undefined') return
  const hub = new QueueHub(createApi())
  ctx.effect(() => injectStyles(document), 'schedule-send: styles')

  const slots = (ctx as unknown as { slots: SlotRegistryLike }).slots
  slots.inject('conversation.input.right', () => slots.register({
    name: 'conversation.input.right',
    id: 'schedule-send',
    order: 1000,
    inject: () => ({ hub }),
  }, SendAnchor as ComponentType<never>))
  slots.inject('conversation.input.dock', () => slots.register({
    name: 'conversation.input.dock',
    id: 'schedule-send',
    order: 15,
    inject: () => ({ hub }),
  }, PendingDock as ComponentType<never>))
}
