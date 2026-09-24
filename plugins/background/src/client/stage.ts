/**
 * The layer behind the app: a fixed, full-viewport element prepended to
 * `<body>` holding two image layers that crossfade. Images are painted as CSS
 * backgrounds so every fit mode (cover, contain, stretch, tile) and position
 * is one declaration, and each image is preloaded before it is swapped in.
 * @module
 */
import type { Appearance, Fit, Position } from '../shared/state.ts'
import type { PoolItem } from './pool.ts'
import { TINT_TOKEN } from './tokens.ts'

export const STAGE_ID = 'dsh-background-stage'
const FADE_MS = 400

const SIZE: Record<Fit, string> = { cover: 'cover', contain: 'contain', stretch: '100% 100%', tile: 'auto' }
const POSITION: Record<Position, string> = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' }

/**
 * CSS `url()` for an arbitrary string.
 * @param url - the image URL.
 * @returns a quoted, escaped url() token.
 */
export function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`
}

/**
 * Inline style for one layer.
 * @param appearance - fit, position, blur.
 * @returns style properties to assign.
 */
export function layerStyle(appearance: Appearance): Record<string, string> {
  return {
    backgroundSize: SIZE[appearance.fit],
    backgroundRepeat: appearance.fit === 'tile' ? 'repeat' : 'no-repeat',
    backgroundPosition: POSITION[appearance.position],
    filter: appearance.blur > 0 ? `blur(${appearance.blur}px)` : '',
    // Blur samples transparent pixels past the edge; scale up to hide the halo.
    transform: appearance.blur > 0 ? `scale(${1 + appearance.blur / 200 + 0.02})` : '',
  }
}

/** Resolves true once `url` has loaded, false on error. */
export type Preloader = (url: string) => Promise<boolean>

const defaultPreload: Preloader = (url) => new Promise((resolve) => {
  const image = new Image()
  image.decoding = 'async'
  image.onload = () => resolve(true)
  image.onerror = () => resolve(false)
  image.src = url
})

/** Owns the stage DOM. */
export class Stage {
  private readonly doc: Document
  private readonly preload: Preloader
  private root: HTMLDivElement | undefined
  private layers: HTMLDivElement[] = []
  private front = 0
  private token = 0
  /** The item currently painted, if any. */
  current: PoolItem | undefined

  constructor(doc: Document, preload: Preloader = defaultPreload) {
    this.doc = doc
    this.preload = preload
  }

  private mount(): HTMLDivElement[] {
    if (this.root?.isConnected === true) return this.layers
    const root = this.doc.createElement('div')
    root.id = STAGE_ID
    root.setAttribute('aria-hidden', 'true')
    Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '0', pointerEvents: 'none', overflow: 'hidden' })
    this.layers = [0, 1].map(() => {
      const layer = this.doc.createElement('div')
      Object.assign(layer.style, { position: 'absolute', inset: '0', opacity: '0', transition: `opacity ${FADE_MS}ms ease` })
      root.append(layer)
      return layer
    })
    // One tint over the image stands in for every (now transparent) app
    // surface; its color is the theme base at the chosen opacity.
    const tint = this.doc.createElement('div')
    Object.assign(tint.style, { position: 'absolute', inset: '0', background: `var(${TINT_TOKEN}, transparent)` })
    root.append(tint)
    this.doc.body.prepend(root)
    this.root = root
    return this.layers
  }

  /**
   * Crossfade to an item.
   * @param item - what to show.
   * @returns false when the image failed to load (nothing changes then).
   */
  async show(item: PoolItem): Promise<boolean> {
    const token = ++this.token
    const ok = await this.preload(item.url)
    if (token !== this.token) return ok // superseded by a newer show/clear
    if (!ok) return false
    const layers = this.mount()
    const back = layers[1 - this.front]!
    const front = layers[this.front]!
    back.style.backgroundImage = cssUrl(item.url)
    Object.assign(back.style, layerStyle(item.appearance))
    back.style.opacity = '1'
    front.style.opacity = '0'
    this.front = 1 - this.front
    this.current = item
    return true
  }

  /**
   * Re-style the visible image without reloading it.
   * @param appearance - new fit/position/blur.
   */
  restyle(appearance: Appearance): void {
    const front = this.layers[this.front]
    if (front !== undefined) Object.assign(front.style, layerStyle(appearance))
    if (this.current !== undefined) this.current = { ...this.current, appearance }
  }

  /** Remove the stage entirely. */
  clear(): void {
    this.token++
    this.root?.remove()
    this.root = undefined
    this.layers = []
    this.current = undefined
  }
}
