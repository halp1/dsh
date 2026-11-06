import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { useEffect, useState } from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UseSession, UseSessionStatus } from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { HostClient, previewBridge, type NativeBridge } from './host-client.ts'
import { MiniSessions } from './session-controller.ts'
import { MiniRoot, Settings } from './ui.tsx'
import { installStyles } from './styles.ts'
import { syncReadState, type StatusStore } from './read-sync.ts'

export const name = 'mini-window'
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'remote.session']
interface Registry {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(key: string, setup: () => () => void): () => void
}
function ChatView(props: ConversationViewsProps) { return <>{props.renderSlot('conversation.session', { view: 'chat' })}</> }
function useNativeState(native: NativeBridge) {
  const [state, setState] = useState({ expanded: false, visible: false })
  useEffect(() => {
    let active = true
    void native.getState().then(value => { if (active) setState(value) }).catch(() => {})
    const off = native.onState(value => setState(value))
    return () => { active = false; off() }
  }, [native])
  return state
}
function Conversation({ renderFactorySlot, useSession, useSessionStatus, useInput, native, client }: PropsRenderFactories & { useSession: UseSession; useSessionStatus: UseSessionStatus; useInput: (select: (state: { attachmentIds: readonly unknown[] }) => number) => number; native: NativeBridge; client: HostClient }) {
  const session = useSession(value => value)
  const shown = useNativeState(native)
  // Reading a finished chat here must count as read in the main window too.
  // Compact mode shows no messages, so only an expanded, visible window counts.
  useEffect(() => {
    if (!shown.visible || !shown.expanded || session.running || session.blank || session.openState === 'loading') return
    void client.markViewed(session.sessionId).catch(() => {})
  }, [shown.visible, shown.expanded, session.running, session.blank, session.openState, session.sessionId, client])
  const pending = useSessionStatus(value => value.get(session.sessionId)?.pendingInteraction?.key)
  const attachmentCount = useInput(value => value.attachmentIds.length)
  // Observe new activity/requests, not manual expand/collapse. Keep the resident editor mounted.
  useEffect(() => { if (session.running || session.promptAttempted || pending || attachmentCount) void native.setExpanded(true).catch(() => {}) }, [session.running, session.promptAttempted, pending, attachmentCount, native])
  useEffect(() => {
    const onInput = (event: Event) => {
      if ((event as InputEvent).isComposing) return
      const target = event.target as HTMLElement | null
      const editor = target?.closest<HTMLElement>('[data-composer-input]')
      if (editor && (editor.innerText.trim().includes('\n') || editor.scrollHeight > 36)) void native.setExpanded(true).catch(() => {})
    }
    document.addEventListener('input', onInput)
    document.addEventListener('compositionend', onInput)
    return () => { document.removeEventListener('input', onInput); document.removeEventListener('compositionend', onInput) }
  }, [native])
  const error = session.lastAgentError ?? session.promptError?.error.message ?? session.openError?.message
  return <>{error && <div className="dshmini-notice" role="alert">{error}</div>}{renderFactorySlot('conversation.content', { variant: 'embedded', phase: session.openState === 'loading' ? 'settling' : 'active', hero: false }, { slots: { views: ChatView } })}</>
}
export function apply(ctx: Context) {
  if (typeof document === 'undefined') return
  const slots = ctx.get('slots') as unknown as Registry
  const remote = ctx.get('remote') as ClientRemote
  const client = new HostClient(undefined, async () => {
    const result = await remote.session.modelCatalog()
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  })
  ctx.effect(() => client.start(), 'mini-window: settings transport')
  ctx.effect(() => installStyles(document), 'mini-window: styles')
  ctx.effect(() => slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'mini-window', order: 55, label: 'Mini Window', inject: () => ({ client }) }, Settings)), 'mini-window: settings tab')
  const native = window.dshMiniWindow?.version === 1 ? window.dshMiniWindow : location.hash === '#dsh-mini-preview' ? previewBridge() : undefined
  if (!native) {
    // The ordinary DSH window: clear unread dots for chats already read in the mini window.
    const sessions = ctx.get('sessions') as unknown as ISessions
    const updatedAt = (id: string) => (sessions.list.getSnapshot().byId as Record<string, { updatedAt?: number } | undefined>)[id]?.updatedAt
    ctx.effect(() => syncReadState(ctx.get('uiSession') as unknown as StatusStore, () => client.getSnapshot().viewed, client.subscribe, updatedAt), 'mini-window: shared read state')
    return
  }
  const controller = new MiniSessions(ctx.get('sessions') as unknown as ISessions, ctx.get('workspaces') as unknown as IWorkspaces, ctx.get('uiWorkspace') as unknown as UiWorkspace, client)
  ctx.effect(() => { document.documentElement.dataset.dshMini = ''; if (!window.dshMiniWindow) document.documentElement.dataset.dshMiniPreview = ''; return () => { delete document.documentElement.dataset.dshMini; delete document.documentElement.dataset.dshMiniPreview; controller.dispose() } }, 'mini-window: renderer lifetime')
  ctx.effect(() => slots.register({ name: 'root', priority: -100, children: { 'mini.conversation': { kind: 'single', scope: 'session' } }, inject: () => ({ controller, client, native }) }, MiniRoot), 'mini-window: companion root')
  ctx.effect(() => slots.inject('mini.conversation', () => slots.register({ name: 'mini.conversation', inject: () => ({ native, client }) }, Conversation)), 'mini-window: embedded chat')
}
