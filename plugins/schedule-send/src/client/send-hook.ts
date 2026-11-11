/**
 * Intercept shift click and right click on the composer's primary Send button.
 *
 * The button has no slot of its own and hashed class names, so the hook
 * starts from an anchor element the plugin renders in
 * `conversation.input.right`, which sits in the same trailing toolbar group as
 * Send. The button is located at event time (it re-renders freely): the
 * group's `button[aria-busy]`, which only the primary action carries, with a
 * hashed `_primary` class as fallback.
 *
 * Listeners sit on the document in the capture phase, which runs before
 * React's root listeners, so stopping the event there keeps React's `onClick`
 * from sending. A plain click is never touched.
 * @module
 */

/** The toolbar group holding both the anchor and Send. */
export function trailingGroup(anchor: Element): Element | null {
  let node: Element | null = anchor.parentElement
  for (let depth = 0; node !== null && depth < 4; depth++, node = node.parentElement) {
    if (findPrimary(node) !== null) return node
  }
  return null
}

/** The primary Send button inside a toolbar group. */
export function findPrimary(group: Element): HTMLButtonElement | null {
  return group.querySelector<HTMLButtonElement>('button[aria-busy]')
    ?? group.querySelector<HTMLButtonElement>('button[class*="_primary"]')
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
