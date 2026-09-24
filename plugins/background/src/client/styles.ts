/**
 * Styles for the Settings → Background tab, built only from the host's
 * `--dsw-*` tokens so it follows light/dark and custom themes. Injected once.
 * @module
 */

export const TAB_STYLE_ID = 'dsh-background-tab-css'

const CSS = `
.dshbg { display: flex; flex-direction: column; gap: 20px; padding: 4px 2px 24px; color: var(--dsw-alias-label-primary); }
.dshbg-section { display: flex; flex-direction: column; gap: 10px; }
.dshbg-heading { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 0; }
.dshbg-add { display: flex; gap: 8px; align-items: center; }
.dshbg-add > :first-child { flex: 1; min-width: 0; }
.dshbg-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin: 0; }
.dshbg-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; margin: 0; }
.dshbg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.dshbg-tile { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 0; border: none; background: none; text-align: left; cursor: pointer; color: inherit; font: inherit; }
.dshbg-thumb { position: relative; aspect-ratio: 16 / 10; border-radius: 10px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }
.dshbg-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dshbg-tile[data-active] .dshbg-thumb { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshbg-tile[data-excluded] .dshbg-thumb img { opacity: .35; }
.dshbg-tile:focus-visible { outline: none; }
.dshbg-tile:focus-visible .dshbg-thumb { outline: 2px solid var(--dsw-alias-brand-primary); }
.dshbg-check { position: absolute; top: 6px; left: 6px; width: 20px; height: 20px; border-radius: 50%; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); display: flex; align-items: center; justify-content: center; }
.dshbg-badge { position: absolute; bottom: 6px; right: 6px; padding: 1px 6px; border-radius: 6px; font-size: 11px; display: flex; gap: 3px; align-items: center; background: color-mix(in srgb, var(--dsw-alias-bg-base) 80%, transparent); color: var(--dsw-alias-label-primary); }
.dshbg-warn { color: var(--dsw-alias-state-warn-primary); }
.dshbg-label { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); }
.dshbg-actions { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
.dshbg-tile:hover .dshbg-actions, .dshbg-tile:focus-within .dshbg-actions { opacity: 1; }
.dshbg-action { width: 24px; height: 24px; border-radius: 6px; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; background: color-mix(in srgb, var(--dsw-alias-bg-base) 85%, transparent); color: var(--dsw-alias-label-primary); }
.dshbg-action:hover { background: var(--dsw-alias-bg-base); }
.dshbg-action[data-on] { color: var(--dsw-alias-brand-primary); }
.dshbg-row { display: grid; grid-template-columns: 92px 1fr auto; gap: 12px; align-items: center; min-height: 32px; }
.dshbg-row > label, .dshbg-row > span:first-child { font-size: 13px; color: var(--dsw-alias-label-primary); }
.dshbg-value { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); min-width: 40px; text-align: right; }
.dshbg-range { width: 100%; accent-color: var(--dsw-alias-brand-primary); }
.dshbg-number { width: 72px; }
.dshbg-inline { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.dshbg-editor { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
.dshbg-editor-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.dshbg-reset { font-size: 12px; border: none; background: none; cursor: pointer; color: var(--dsw-alias-brand-primary); padding: 0; }
.dshbg-reset[disabled] { color: var(--dsw-alias-label-tertiary); cursor: default; }
`

/**
 * Inject the tab stylesheet once.
 * @param doc - the page.
 * @returns remover.
 */
export function injectTabStyles(doc: Document): () => void {
  if (doc.getElementById(TAB_STYLE_ID) !== null) return () => {}
  const style = doc.createElement('style')
  style.id = TAB_STYLE_ID
  style.textContent = CSS
  doc.head.append(style)
  return () => { style.remove() }
}
