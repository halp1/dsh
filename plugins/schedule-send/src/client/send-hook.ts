/**
 * Intercept shift click and right click on the composer's primary Send button.
 *
 * The button has no slot of its own and hashed class names, so the hook
 * starts from an anchor element the plugin renders in
 * `conversation.input.right`, which sits in the same trailing toolbar group as
 * Send. The button is located at event time (it re-renders freely).
 *
 * Only buttons the composer renders itself count. Every slot entry (the
 * model picker, other plugins' controls, this anchor) sits inside a
 * `[data-slot]` wrapper below the group, and several of those buttons carry
 * `aria-busy` too. Among the composer's own buttons, Send is the last one
 * with `aria-busy`. Stop, which can sit beside it, has none.
 *
 * Listeners sit on the document in the capture phase, which runs before
 * React's root listeners, so stopping the event there keeps React's `onClick`
 * from sending. A plain click is never touched.
 * @module
 */

/** Buttons rendered by the container itself, not by a slot entry inside it. */
function ownButtons(container: Element): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].filter((button) => {
    const slot = button.parentElement?.closest('[data-slot]')
    return slot === null || slot === undefined || !container.contains(slot)
  })
}

/** The toolbar group holding both the anchor and Send. */
export function trailingGroup(anchor: Element): Element | null {
  let node: Element | null = anchor.parentElement
  for (let depth = 0; node !== null && depth < 6; depth++, node = node.parentElement) {
    if (findPrimary(node) !== null) return node
  }
  return null
}

/** The primary Send button inside a toolbar group. */
export function findPrimary(group: Element): HTMLButtonElement | null {
  const own = ownButtons(group)
  return own.findLast((b) => b.hasAttribute('aria-busy'))
    ?? own.findLast((b) => /(^|\s)\S*_primary(\s|$)/.test(b.className))
    ?? null
}

export interface SendHookOptions {
  /** Whether the current draft can be scheduled at all (non-empty, not sending). */
  canOpen(): boolean
  /** Open the scheduler for this button. */
  open(button: HTMLButtonElement): void
}

/**
 * Bind the hook for one composer.
 * @param anchor - element rendered in the composer's trailing group.
 * @param doc - the document to listen on.
 * @returns the unbinder.
 */
export function bindSendHook(anchor: Element, options: SendHookOptions, doc: Document = anchor.ownerDocument): () => void {
  const handler = (event: MouseEvent) => {
    if (event.type === 'click' && !event.shiftKey) return
    if (event.type === 'click' && event.button !== 0) return
    const target = event.target
    if (!(target instanceof doc.defaultView!.Element)) return
    const button = target.closest('button')
    if (button === null || button.disabled) return
    const group = trailingGroup(anchor)
    if (group === null || findPrimary(group) !== button) return
    if (!options.canOpen()) return
    event.preventDefault()
    event.stopPropagation()
    options.open(button)
  }
  doc.addEventListener('click', handler, true)
  doc.addEventListener('contextmenu', handler, true)
  return () => {
    doc.removeEventListener('click', handler, true)
    doc.removeEventListener('contextmenu', handler, true)
  }
}
