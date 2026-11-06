/**
 * Switcher styles, built only from the host's `--dsw-*` tokens so light,
 * dark, and custom themes all apply. Injected once.
 *
 * The card class rides on the primitives Modal's dialog element, whose own
 * rules come from a hashed CSS module; `.dshqs.dshqs` doubles the class so
 * these rules win without depending on that hash or on stylesheet order.
 * @module
 */

export const STYLE_ID = 'dsh-quickswitcher-css'

const CSS = `
[role="presentation"]:has(> .dshqs) { align-items: flex-start; padding-top: max(12vh, var(--dsh-frame-overlay-top, 24px)); }
.dshqs.dshqs { width: min(640px, calc(100vw - 32px)); gap: 0; padding: 0; animation: none; }
.dshqs-input { box-sizing: border-box; width: 100%; height: 52px; padding: 0 18px; border: 0; border-bottom: .5px solid var(--dsw-alias-border-l2); outline: none; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 15px; }
.dshqs-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dshqs-list { max-height: min(420px, 60vh); overflow-y: auto; overscroll-behavior: contain; padding: 6px; scroll-padding: 28px 0 6px; }
.dshqs-list:empty { display: none; }
.dshqs-group + .dshqs-group { margin-top: 6px; }
.dshqs-heading { position: sticky; top: -6px; z-index: 1; margin: 0; padding: 6px 10px 4px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 500; line-height: 16px; }
.dshqs-option { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 6px 10px; border-radius: var(--dsw-radius-md); cursor: pointer; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }
.dshqs-option[aria-selected="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dshqs-main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.dshqs-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshqs-snippet { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshqs-meta { display: flex; align-items: center; gap: 8px; flex: none; max-width: 45%; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dshqs-context { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: ltr; }
.dshqs-age { flex: none; min-width: 26px; text-align: right; font-variant-numeric: tabular-nums; }
.dshqs-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-business-primary); }
.dshqs mark { background: none; color: var(--dsw-alias-brand-primary); font-weight: 600; }
.dshqs-empty { padding: 18px 10px; color: var(--dsw-alias-label-tertiary); font-size: 13px; text-align: center; }
.dshqs-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
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
