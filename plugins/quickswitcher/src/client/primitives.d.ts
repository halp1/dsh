/**
 * The slice of the host's runtime primitives module this plugin uses. The
 * module table answers the specifier at runtime; the published type package
 * lags the runtime (it lacks `backdropBlur` and `shortcutModal`), so the
 * shape is declared here from the shipped 0.2.1 Modal.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { KeyboardEventHandler, ReactNode, ReactPortal } from 'react'

  /** Centered, body-portaled dialog with Escape and mask-click dismissal. */
  export function Modal(props: {
    open: boolean
    onClose: () => void
    /** Accessible name. */
    title: string
    headless: true
    children?: ReactNode
    className?: string
    onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>
    backdropBlur?: boolean
    /** Reported to shortcut owners as `context.modal`. */
    shortcutModal?: string
  }): ReactPortal | null
}
