/**
 * Makes the app see-through while a background is showing: forces the page
 * backgrounds the host hard-codes (`body`, `#root`) to transparent, lifts
 * `#root` above the stage, and turns the theme's background tokens
 * translucent through the official `ctx.theme.overrideTokens` API.
 * @module
 */
import { buildOverrides, readBaseFromRules, type BaseValues, type RuleLike } from './tokens.ts'

export const OVERRIDE_SOURCE = 'dsh-plugin-background'
const STYLE_ID = 'dsh-background-css'
const ATTR = 'data-dsh-bg'

const CSS = `
html[${ATTR}], html[${ATTR}] body { background: transparent !important; }
html[${ATTR}] #root { position: relative; z-index: 1; background: transparent !important; }
html[${ATTR}] #root [class*="_fade"] { display: none !important; }
`

/** The slice of the theme runtime this module uses. */
export interface ThemeOverrides {
  overrideTokens(source: string, tokens: Record<string, { light: string; dark: string }>): () => void
}

function* flatten(rules: CSSRuleList | undefined): Generator<RuleLike> {
  if (rules === undefined) return
  for (const rule of Array.from(rules)) {
    if ('selectorText' in rule) yield rule as unknown as RuleLike
    if ('cssRules' in rule) yield* flatten((rule as CSSGroupingRule).cssRules)
  }
}

/**
 * Read the raw background token values from the document's stylesheets.
 * @param doc - the page.
 * @returns values per scheme (fallbacks fill anything unreadable).
 */
export function readBaseValues(doc: Document): BaseValues {
  const rules: RuleLike[] = []
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      rules.push(...flatten(sheet.cssRules))
    } catch {
      // Cross-origin sheet: not ours to read.
    }
  }
  return readBaseFromRules(rules)
}

/** Toggles translucency. */
export class Transparency {
  private readonly doc: Document
  private readonly theme: ThemeOverrides
  private dispose: (() => void) | undefined
  private base: BaseValues | undefined
  private opacity: number | undefined

  constructor(doc: Document, theme: ThemeOverrides) {
    this.doc = doc
    this.theme = theme
  }

  /**
   * Turn translucency on, or change its opacity.
   * @param opacity - alpha for the app surfaces.
   */
  enable(opacity: number): void {
    if (this.opacity === opacity && this.dispose !== undefined) return
    if (this.doc.getElementById(STYLE_ID) === null) {
      const style = this.doc.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      this.doc.head.append(style)
    }
    this.doc.documentElement.setAttribute(ATTR, '')
    // Read once, before our own overrides land (they are inline on body, not
    // rules, so later reads would still be clean; caching just saves work).
    this.base ??= readBaseValues(this.doc)
    // Re-overriding under the same source replaces the layer in place and
    // leaves the previous disposer inert, so only the newest one is kept.
    this.dispose = this.theme.overrideTokens(OVERRIDE_SOURCE, buildOverrides(this.base, opacity))
    this.opacity = opacity
  }

  /** Restore the opaque app. */
  disable(): void {
    this.dispose?.()
    this.dispose = undefined
    this.opacity = undefined
    this.doc.documentElement.removeAttribute(ATTR)
    this.doc.getElementById(STYLE_ID)?.remove()
  }
}
