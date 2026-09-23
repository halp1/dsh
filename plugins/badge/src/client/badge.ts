/**
 * The Badging API surface: turning a number into an app-icon badge.
 *
 * `navigator.setAppBadge` only exists on installed PWAs in Chromium-family
 * browsers (and is a silent no-op in a normal tab on some of them), so every
 * call is both feature-detected and try/caught. A browser that cannot badge is
 * a degraded surface, never an error: the plugin stays loaded and keeps its
 * count current so the title-bar fallback still reflects reality.
 *
 * The applier is deliberately stateful in one respect — it remembers the last
 * value it published and skips redundant platform calls. Session snapshots
 * invalidate on every stream frame (token deltas included), so an unguarded
 * applier would hammer setAppBadge many times a second while a turn streams.
 */

/** The parts of `navigator` this module uses; narrowed so tests can fake it. */
export interface BadgeTarget {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/**
 * Optional page-title mirror for browsers without the Badging API.
 *
 * Best-effort by nature: ui-layout rewrites `document.title` whenever the
 * selected session's title changes, which drops the prefix until the next
 * publish. The app badge is the authoritative surface; this is a convenience
 * for ordinary tabs.
 */
export interface TitleTarget {
  get title(): string
  set title(value: string)
}

/** Knobs for how a count is presented. */
export interface BadgeApplierOptions {
  /**
   * Also mirror the count into the document title as a `(n)` prefix. Useful in
   * an ordinary tab, where the Badging API is unavailable but the tab strip is
   * visible.
   */
  mirrorTitle: boolean
}

/** Title mirroring off: the installed-app badge is the primary surface. */
export const DEFAULT_APPLIER_OPTIONS: BadgeApplierOptions = { mirrorTitle: false }

/** Matches a `(12) ` counter prefix this module previously wrote onto the title. */
const TITLE_PREFIX = /^\(\d+\)\s+/

/**
 * Strip a counter prefix from a title.
 * @param title - the current document title.
 * @returns the title without any leading `(n) `.
 */
export function stripTitleCount(title: string): string {
  return title.replace(TITLE_PREFIX, '')
}

/**
 * Compose a title carrying a count prefix.
 * @param title - the base title (any existing prefix is replaced).
 * @param count - the unread count; 0 yields the bare title.
 * @returns the title to publish.
 */
export function titleWithCount(title: string, count: number): string {
  const base = stripTitleCount(title)
  return count > 0 ? `(${count}) ${base}` : base
}

/** Whether the current environment can show an app badge at all. */
export function badgingSupported(target: BadgeTarget | undefined): boolean {
  return target !== undefined
    && typeof target.setAppBadge === 'function'
    && typeof target.clearAppBadge === 'function'
}

/**
 * Publishes counts to the app icon, skipping redundant platform calls.
 *
 * Construction does not touch the platform: the first {@link BadgeApplier.publish}
 * establishes the baseline, so a plugin that loads with nothing unread still
 * clears a badge left over from a previous page load.
 */
export class BadgeApplier {
  private readonly target: BadgeTarget | undefined
  private readonly title: TitleTarget | undefined
  private readonly getOptions: () => BadgeApplierOptions
  /** Last published count; undefined until the first publish. */
  private published: number | undefined

  /**
   * @param target - the Badging API host (normally `navigator`).
   * @param title - the document, when the title should mirror the count.
   * @param options - presentation knobs, or a getter when they can change at
   * runtime (the title mirror is a live user preference).
   */
  constructor(
    target: BadgeTarget | undefined,
    title: TitleTarget | undefined,
    options: BadgeApplierOptions | (() => BadgeApplierOptions) = DEFAULT_APPLIER_OPTIONS,
  ) {
    this.target = target
    this.title = title
    this.getOptions = typeof options === 'function' ? options : () => options
  }

  /** The count currently published, or undefined before the first publish. */
  get current(): number | undefined {
    return this.published
  }

  /**
   * Publish one count. A repeat of the last published value is dropped before
   * it reaches the platform, which is what keeps a streaming turn from issuing
   * a badge call per frame.
   * @param count - unread items; 0 clears the badge.
   * @param force - write even when the value is unchanged (a presentation
   * setting, rather than the count, changed).
   * @returns true when the value reached the platform.
   */
  publish(count: number, force = false): boolean {
    const next = Math.max(0, Math.trunc(count))
    if (this.published === next && !force) return false
    this.published = next
    this.write(next)
    return true
  }

  /**
   * Remove the badge and forget the published baseline (plugin teardown), so a
   * later reload starts clean rather than inheriting a stale icon.
   */
  reset(): void {
    this.published = undefined
    this.write(0)
  }

  /** Feature-detected, failure-tolerant platform write. */
  private write(count: number): void {
    const target = this.target
    if (badgingSupported(target)) {
      try {
        // Both calls are async; a rejection (permission, unsupported surface)
        // is swallowed for the same reason the try/catch exists — badging is
        // decoration, and an unhandled rejection would be noise in the console.
        const result = count > 0 ? target?.setAppBadge?.(count) : target?.clearAppBadge?.()
        void result?.catch?.(() => {})
      } catch {
        // Synchronous throw on surfaces that expose the method but refuse it.
      }
    }
    const title = this.title
    if (title === undefined) return
    try {
      // Turning the mirror off must also remove a prefix it previously wrote,
      // so the un-mirrored branch strips rather than skipping.
      title.title = this.getOptions().mirrorTitle
        ? titleWithCount(title.title, count)
        : stripTitleCount(title.title)
    } catch {
      // A document that refuses title writes is not worth failing over.
    }
  }
}
