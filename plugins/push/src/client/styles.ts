/**
 * Button styles. The button also carries the sidebar's own icon-button class
 * (copied from the row's "..." button at mount time), so size, color, hover
 * and focus match the built-in actions. These rules only add the count and
 * the disabled, running, and failed states, from `--dsw-*` tokens.
 * @module
 */

export const STYLE_ID = 'dsh-plugin-push-css'

const CSS = `
.dshpush-host { display: contents; }
.dshpush.dshpush { width: auto; min-width: 24px; gap: 2px; padding: 0 4px; font: inherit; font-size: 11px; font-variant-numeric: tabular-nums; line-height: 16px; }
.dshpush.dshpush[aria-disabled="true"] { cursor: default; opacity: .4; }
.dshpush.dshpush[aria-disabled="true"]:hover { color: var(--dsw-alias-label-tertiary); }
.dshpush.dshpush[data-state="running"] { opacity: 1; color: var(--dsw-alias-label-secondary); }
.dshpush.dshpush[data-state="failed"] { color: var(--dsw-alias-state-error-primary, #e5484d); }
.dshpush-spin { animation: dshpush-spin .9s linear infinite; }
@keyframes dshpush-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dshpush-spin { animation-duration: 2.4s; } }
`

/**
 * Inject the stylesheet once.
 * @param doc - the page.
 * @returns remover.
 */
export function injectStyles(doc: Document): () => void {
  if (doc.getElementById(STYLE_ID) !== null) return () => {}
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  doc.head.append(style)
  return () => { style.remove() }
}
