/**
 * The push button and the error notice.
 * @module
 */
import { IconLoadingOutlineRegular, IconWarningOutlineRegular, Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import type { PushStore } from './store.ts'
import { buttonView } from './view.ts'

/** Arrow up out of a tray, drawn on the host icon grid (16px, 1px stroke). */
function PushIcon(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 10.5V2.5M8 2.5L4.75 5.75M8 2.5L11.25 5.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 10V12.5C2.5 13.0523 2.94772 13.5 3.5 13.5H12.5C13.0523 13.5 13.5 13.0523 13.5 12.5V10" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

export interface PushButtonProps {
  readonly workspaceId: string
  readonly store: PushStore
  /** Class copied from the sidebar's own icon buttons. */
  readonly hostClass: string
  readonly onPush: (workspaceId: string) => void
}

/** One workspace's push button. */
export function PushButton({ workspaceId, store, hostClass, onPush }: PushButtonProps): ReactNode {
  const button = useSyncExternalStore(store.subscribe, () => store.button(workspaceId))
  const view = buttonView(button)
  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // The row toggles expansion on click.
    event.stopPropagation()
    if (view.enabled) onPush(workspaceId)
  }, [view.enabled, onPush, workspaceId])

  return (
    <Tooltip label={view.label} side="bottom" align="end" delayMs={500} portal maxWidth={320}>
      <button
        type="button"
        className={`${hostClass} dshpush`}
        aria-label={view.label}
        aria-disabled={!view.enabled}
        aria-busy={view.state === 'running'}
        data-state={view.state}
        onClick={onClick}
        onDoubleClick={stopPropagation}
        onPointerDown={stopPropagation}
        onMouseDown={stopPropagation}
        draggable={false}
        onDragStart={preventDrag}
      >
        {view.state === 'running'
          ? <IconLoadingOutlineRegular className="dshpush-spin" />
          : view.state === 'failed' ? <IconWarningOutlineRegular /> : <PushIcon />}
        {view.count !== undefined && <span aria-hidden="true">{view.count}</span>}
      </button>
    </Tooltip>
  )
}

function stopPropagation(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}

function preventDrag(event: { preventDefault(): void, stopPropagation(): void }): void {
  event.preventDefault()
  event.stopPropagation()
}

/** Frame-wide notice for push outcomes. Errors hold long enough to read. */
export function PushNotice({ store }: { store: PushStore }): ReactNode {
  const notice = useSyncExternalStore(store.subscribe, store.notice)
  if (notice === null) return null
  return notice.tone === 'success'
    ? <Toast key={notice.seq} text={notice.text} tone="success" onDone={store.dismiss} />
    : <Toast key={notice.seq} text={<span className="dshpush-error">{notice.text}</span>} icon={<IconWarningOutlineRegular />} holdMs={10_000} onDone={store.dismiss} />
}
