/**
 * Clock-driven rotation. The shown index is a pure function of wall-clock
 * time and the pool, so every device lands on the same image at the same
 * moment without writing anything back to the host.
 * @module
 */

/**
 * 32-bit FNV-1a hash.
 * @param text - input.
 * @returns unsigned 32-bit hash.
 */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Small seeded PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Seeded Fisher–Yates permutation of `0..n-1`.
 * @param n - length.
 * @param seed - 32-bit seed.
 * @returns the permutation.
 */
export function permutation(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i)
  const random = mulberry32(seed)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/**
 * The pool index to show at `now`.
 * @param now - epoch ms.
 * @param intervalMin - minutes per image.
 * @param n - pool length.
 * @param order - sequential or shuffle.
 * @param seedKey - pool identity (item keys joined); shuffle depends only on it and time.
 * @returns an index in `0..n-1` (0 for an empty pool).
 */
export function pickIndex(now: number, intervalMin: number, n: number, order: 'sequential' | 'shuffle', seedKey: string): number {
  if (n <= 1) return 0
  const slot = Math.floor(now / (intervalMin * 60_000))
  const position = ((slot % n) + n) % n
  if (order === 'sequential') return position
  const cycle = Math.floor(slot / n)
  return permutation(n, (fnv1a(seedKey) ^ cycle) >>> 0)[position]!
}

/**
 * Milliseconds until the next slot boundary.
 * @param now - epoch ms.
 * @param intervalMin - minutes per image.
 * @returns 1..interval ms.
 */
export function msUntilNext(now: number, intervalMin: number): number {
  const interval = intervalMin * 60_000
  return interval - (((now % interval) + interval) % interval)
}
