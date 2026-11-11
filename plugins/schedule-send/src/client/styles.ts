/**
 * Plugin CSS as a plain string, built on the host's `--dsw-*` theme tokens so
 * it follows light, dark, and custom themes.
 * @module
 */

const CSS = `
.dss-pop {
  position: fixed;
  z-index: 2147483000;
  box-sizing: border-box;
  width: 300px;
  max-width: calc(100vw - 16px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-base));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 28px rgba(0,0,0,.18));
  border: .5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family, system-ui);
  font-size: 13px;
  line-height: 20px;
}
.dss-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 2px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dss-seg button {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  padding: 4px 0;
  border-radius: calc(var(--dsw-radius-md, 8px) - 2px);
  cursor: pointer;
}
.dss-seg button[aria-pressed="true"] {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  box-shadow: 0 0 0 .5px var(--dsw-alias-border-l2);
}
.dss-row {
  display: flex;
  gap: 8px;
}
.dss-pop input,
.dss-pop select {
  box-sizing: border-box;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: .5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  color-scheme: inherit;
}
.dss-pop input[type="number"] {
  width: 72px;
  flex: none;
}
.dss-row select,
.dss-row input[type="date"],
.dss-row input[type="time"] {
  flex: 1;
}
.dss-pop :is(input, select, button):focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.dss-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dss-chips button {
  height: 24px;
  padding: 0 10px;
  border: .5px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dss-chips button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dss-chips button[aria-pressed="true"] {
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-state-business-tertiary, transparent);
}
.dss-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: .5px solid var(--dsw-alias-border-l1);
}
.dss-when {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dss-when b {
  font-weight: 500;
}
.dss-when span {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}
.dss-when[data-bad] span {
  color: var(--dsw-alias-state-error-primary);
}
.dss-go {
  flex: none;
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-button-info-fill);
  color: #fff;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.dss-go:hover:not(:disabled) {
  background: var(--dsw-alias-button-info-hover);
}
.dss-go:disabled {
  opacity: .4;
  cursor: default;
}
.dss-anchor {
  display: none;
}

.dss-dock {
  box-sizing: border-box;
  width: calc(100% - var(--dsh-composer-side-clearance, 0px) * 2 - var(--dsh-composer-dock-inset, 12px) * 2);
  max-width: calc(var(--dsh-composer-card-max-width, 100%) - var(--dsh-composer-dock-inset, 12px) * 2);
  margin: 0 auto calc(0px - var(--dsh-composer-stack-gap, 0px) - 3px);
  flex: none;
}
.dss-panel {
  isolation: isolate;
  position: relative;
  overflow: hidden;
  padding: 2px 0;
  border-radius: var(--dsw-radius-lg, 12px) var(--dsw-radius-lg, 12px) 0 0;
}
.dss-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-base));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  pointer-events: none;
}
.dss-panel::after {
  content: "";
  position: absolute;
  inset: 0;
  border: .5px solid var(--dsw-alias-border-l1);
  border-bottom: none;
  border-radius: inherit;
  pointer-events: none;
}
.dss-list {
  max-height: 180px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}
.dss-item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 4px 5px 4px 12px;
  font-size: 13px;
  line-height: 20px;
}
.dss-item + .dss-item {
  box-shadow: inset 0 1px 0 var(--dsw-alias-border-l1);
}
.dss-item-icon {
  flex: none;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
}
.dss-item[data-failed] .dss-item-icon,
.dss-item[data-failed] .dss-item-when {
  color: var(--dsw-alias-state-error-primary);
}
.dss-item-when {
  flex: none;
  color: var(--dsw-alias-state-business-primary);
  font-weight: 500;
  white-space: nowrap;
}
.dss-item-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.dss-item-actions {
  flex: none;
  display: flex;
  gap: 2px;
}
.dss-item-actions button {
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}
.dss-item-actions button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dss-item-actions button:disabled {
  opacity: .5;
  cursor: default;
}
`

const TAG = 'dsh-plugin-schedule-send'

/** Insert the stylesheet once. @returns the remover. */
export function injectStyles(doc: Document): () => void {
  if (doc.querySelector(`style[data-plugin="${TAG}"]`) !== null) return () => {}
  const style = doc.createElement('style')
  style.dataset.plugin = TAG
  style.textContent = CSS
  doc.head.appendChild(style)
  return () => style.remove()
}
