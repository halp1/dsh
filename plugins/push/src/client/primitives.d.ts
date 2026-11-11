/**
 * The slice of the host's runtime primitives module this plugin uses. The
 * module table answers the specifier at runtime. The shapes are declared
 * here from the shipped 0.2.2 bundle.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement, ReactNode, ReactPortal } from 'react'

  /** Hover and focus tooltip around exactly one focusable child. */
  export function Tooltip(props: {
    label: ReactNode | (() => ReactNode)
    side?: 'top' | 'right' | 'bottom' | 'left'
    align?: 'start' | 'center' | 'end'
    delayMs?: number
    portal?: boolean
    maxWidth?: number
    children: ReactElement
  }): ReactElement

  /** Frame-wide notice that fades out after `holdMs` and then calls `onDone`. */
  export function Toast(props: {
    text: ReactNode
    tone?: 'success'
    icon?: ReactNode
    holdMs?: number
    onDone: () => void
  }): ReactPortal

  export function IconWarningOutlineRegular(props: { size?: number, className?: string }): ReactElement
  export function IconLoadingOutlineRegular(props: { size?: number, className?: string }): ReactElement
}
