/**
 * dsh-plugin-push, browser half.
 *
 * Adds a push button to every workspace row of the sidebar, between the "..."
 * menu and New Session. The button is enabled only while the workspace's
 * branch has commits the remote does not, and a click runs `git pull` then
 * `git push` on the host. Failures show in a frame-wide notice.
 *
 * Status is polled while the page is visible, and refreshed on focus, so a
 * commit the agent makes shows up without a reload.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PushButton, PushNotice } from './button.tsx'
import { installRowButtons, type ButtonRenderer } from './mount.ts'
import { createPushStore } from './store.ts'
import { refreshStatus, runPush, type Fetcher } from './actions.ts'
import { injectStyles } from './styles.ts'

export { buttonView } from './view.ts'
export { installRowButtons, workspaceIdOf } from './mount.ts'
export { createPushStore } from './store.ts'
export { refreshStatus, runPush } from './actions.ts'

/** Stable Cordis plugin name. */
export const name = 'push'

export const inject = ['slots']

const POLL_MS = 15_000

interface SlotsLike {
  inject(key: string, setup: () => () => void): void
  register(options: { name: string, id: string, order?: number, inject?: () => object }, component: unknown): () => void
}

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  if (typeof document === 'undefined') return
  const { slots } = ctx as unknown as { slots: SlotsLike }
  const store = createPushStore()
  const fetcher: Fetcher = (input, init) => fetch(input, init)
  let rows: ReturnType<typeof installRowButtons> | undefined

  const refresh = async () => {
    await refreshStatus(store, fetcher)
    rows?.sync()
  }
  const onPush = (workspaceId: string) => {
    void runPush(store, fetcher, workspaceId).then(refresh)
  }

  ctx.effect(() => injectStyles(document), 'push: styles')

  const renderer: ButtonRenderer = {
    mount(host, workspaceId, hostClass) {
      const root = createRoot(host)
      root.render(createElement(PushButton, { workspaceId, store, hostClass, onPush }))
      // Unmounting synchronously inside another root's commit warns, so defer.
      return () => { queueMicrotask(() => { root.unmount() }) }
    },
  }

  ctx.effect(() => {
    rows = installRowButtons(document, renderer, store.has)
    return () => {
      rows?.dispose()
      rows = undefined
    }
  }, 'push: workspace row buttons')

  ctx.effect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    const onWake = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, 'push: status polling')

  slots.inject('shell.overlay', () => slots.register({
    name: 'shell.overlay',
    id: 'dsh-plugin-push.notice',
    order: 900,
    inject: () => ({ store }),
  }, PushNotice))
}
