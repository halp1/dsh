/**
 * Translucent theme tokens.
 *
 * The app nests several surfaces painted with the same token (frame → column
 * → panel root), so giving each one alpha 0.85 compounds to ~0.997 and hides
 * the image. Instead the surface tokens become fully transparent and a single
 * tint layer on the stage — {@link TINT_TOKEN}, the base color at the chosen
 * opacity — stands in for all of them. Floating layers (menus, popovers, the
 * settings panel) stay nearly opaque for legibility.
 *
 * The host's builtin light/dark themes register empty token maps; the actual
 * values are stylesheet rules on `body` and `body[data-ds-dark-theme]` that
 * point at the static palette (`var(--dsw-static-neutral-bluish-950)` …). So
 * colors are built with `color-mix(… transparent)` around those raw values:
 * no color parsing, and both schemes are covered in one override set.
 * @module
 */

/** Custom property the stage's tint layer paints with. */
export const TINT_TOKEN = '--dsh-background-tint'

/** Surfaces that fill the app window: transparent, replaced by the tint. */
export const SURFACE_TOKENS: readonly string[] = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-specific-sidebar-fill',
]

/** Floating layers (menus, popovers, settings panel): kept readable. */
export const FLOATING_TOKENS: readonly string[] = [
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-module-platform',
]

/** Minimum alpha for {@link FLOATING_TOKENS}. */
export const FLOATING_FLOOR = 0.9

/** Raw token values per scheme. */
export interface BaseValues {
  light: Record<string, string>
  dark: Record<string, string>
}

/** The dsh 0.1.7 stylesheet values, used when a rule cannot be read. */
export const FALLBACK_VALUES: BaseValues = {
  light: {
    '--dsw-alias-bg-base': 'var(--dsw-static-neutral-bluish-00)',
    '--dsw-alias-bg-layer-1': 'var(--dsw-static-neutral-bluish-00)',
    '--dsw-specific-sidebar-fill': 'var(--dsw-static-neutral-bluish-50)',
    '--dsw-alias-bg-layer-2': 'var(--dsw-static-neutral-bluish-00)',
    '--dsw-alias-bg-layer-3': 'var(--dsw-static-neutral-bluish-00)',
    '--dsw-alias-bg-overlay': 'var(--dsw-static-neutral-bluish-150)',
    '--dsw-alias-bg-module-platform': 'var(--dsw-static-neutral-bluish-60)',
  },
  dark: {
    '--dsw-alias-bg-base': 'var(--dsw-static-neutral-bluish-950)',
    '--dsw-alias-bg-layer-1': 'var(--dsw-static-neutral-bluish-875)',
    '--dsw-specific-sidebar-fill': 'var(--dsw-static-neutral-bluish-900)',
    '--dsw-alias-bg-layer-2': 'var(--dsw-static-neutral-bluish-850)',
    '--dsw-alias-bg-layer-3': 'var(--dsw-static-neutral-bluish-800)',
    '--dsw-alias-bg-overlay': 'var(--dsw-static-neutral-bluish-700)',
    '--dsw-alias-bg-module-platform': 'var(--dsw-static-neutral-bluish-800)',
  },
}

const ALL_TOKENS = [...SURFACE_TOKENS, ...FLOATING_TOKENS]

/**
 * A color at reduced alpha.
 * @param value - any CSS color (including `var(...)`).
 * @param alpha - 0..1.
 * @returns the value unchanged at alpha ≥ 1, else a `color-mix` toward transparent.
 */
export function translucent(value: string, alpha: number): string {
  if (alpha >= 1) return value
  const pct = Math.round(Math.max(0, alpha) * 1000) / 10
  return `color-mix(in srgb, ${value} ${pct}%, transparent)`
}

/**
 * Overrides for `ctx.theme.overrideTokens`.
 * @param base - raw values per scheme.
 * @param opacity - the chosen app opacity.
 * @returns `{ token: { light, dark } }` for every background token plus the tint.
 */
export function buildOverrides(base: BaseValues, opacity: number): Record<string, { light: string; dark: string }> {
  const raw = (scheme: 'light' | 'dark', token: string) => base[scheme][token] ?? FALLBACK_VALUES[scheme][token]!
  const out: Record<string, { light: string; dark: string }> = {}
  for (const token of SURFACE_TOKENS) {
    out[token] = opacity >= 1
      ? { light: raw('light', token), dark: raw('dark', token) }
      : { light: 'transparent', dark: 'transparent' }
  }
  const floating = Math.max(opacity, FLOATING_FLOOR)
  for (const token of FLOATING_TOKENS) {
    out[token] = { light: translucent(raw('light', token), floating), dark: translucent(raw('dark', token), floating) }
  }
  const base0 = SURFACE_TOKENS[0]!
  out[TINT_TOKEN] = { light: translucent(raw('light', base0), opacity), dark: translucent(raw('dark', base0), opacity) }
  return out
}

/** The subset of CSSStyleRule this module reads. */
export interface RuleLike {
  selectorText?: string
  style?: { getPropertyValue(name: string): string }
}

/**
 * Read raw token values from stylesheet rules: `body` rules feed light,
 * `body[data-ds-dark-theme]` rules feed dark; later rules win. Missing tokens
 * come from {@link FALLBACK_VALUES}.
 * @param rules - flattened CSS style rules.
 * @returns values for both schemes.
 */
export function readBaseFromRules(rules: Iterable<RuleLike>): BaseValues {
  const base: BaseValues = { light: { ...FALLBACK_VALUES.light }, dark: { ...FALLBACK_VALUES.dark } }
  for (const rule of rules) {
    const selectors = rule.selectorText?.split(',').map((s) => s.trim()) ?? []
    const scheme = selectors.includes('body[data-ds-dark-theme]') ? 'dark' : selectors.includes('body') ? 'light' : undefined
    if (scheme === undefined || rule.style === undefined) continue
    for (const token of ALL_TOKENS) {
      const value = rule.style.getPropertyValue(token).trim()
      if (value !== '') base[scheme][token] = value
    }
  }
  return base
}
