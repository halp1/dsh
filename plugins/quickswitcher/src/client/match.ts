/**
 * Fuzzy subsequence matching with highlight ranges.
 *
 * Every query character must appear in the text in order. Among the possible
 * alignments, a greedy scan that prefers word starts picks one, and the score
 * rewards what people type when they mean something: the text's start, the
 * start of words, and unbroken runs. Gaps cost a little, so a tight match
 * beats a scattered one.
 * @module
 */

/** A half-open `[start, end)` character range to highlight. */
export type Range = readonly [number, number]

/** A successful match. */
export interface Match {
  readonly score: number
  readonly ranges: readonly Range[]
}

const SCORE_CHAR = 1
const BONUS_START = 8
/** The first query character landing on a word start. */
const BONUS_BOUNDARY = 6
/** A later run beginning at a word start, as in acronyms. Kept small so scattered initials never beat a whole word. */
const BONUS_ACRONYM = 2
const BONUS_CONSECUTIVE = 5
const PENALTY_GAP = 0.25
const PENALTY_GAP_MAX = 3
/** Runs of matched characters allowed to start in the middle of a word. */
const MAX_WEAK_RUNS = 1

/** Whether position `index` of `text` begins a word. */
function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true
  const prev = text[index - 1] ?? ''
  const here = text[index] ?? ''
  if (/[\s\-_/.\\:,()[\]]/.test(prev)) return true
  // camelCase hump: lower then upper.
  return /[a-z]/.test(prev) && /[A-Z]/.test(here)
}

/**
 * Match a query against one text.
 * @param query - what the user typed; surrounding whitespace is ignored.
 * @param text - candidate text.
 * @returns the score and highlight ranges, or null when the query does not fit.
 */
export function fuzzyMatch(query: string, text: string): Match | null {
  const needle = query.trim().toLowerCase()
  if (needle === '') return { score: 0, ranges: [] }
  const hay = lowerKeepingLength(text)
  if (needle.length > hay.length) return null
  // A literal occurrence, preferably at a word start, beats any alignment the
  // greedy scan can find: "proof" in "part 3b proof" should light up "proof".
  const literal = literalMatch(needle, text, hay)
  const scattered = scatteredMatch(needle, text, hay)
  if (literal === null) return scattered
  return scattered !== null && scattered.score > literal.score ? scattered : literal
}

/** Score one literal occurrence: the best one at a word start, else the first. */
function literalMatch(needle: string, text: string, hay: string): Match | null {
  let first = -1
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (first === -1) first = at
    if (isBoundary(text, at)) return scorePositions(text, hay, Array.from(needle, (_, i) => at + i))
  }
  return first === -1 ? null : scorePositions(text, hay, Array.from(needle, (_, i) => first + i))
}

/** Greedy in-order alignment that prefers word starts. */
function scatteredMatch(needle: string, text: string, hay: string): Match | null {
  // latest[q]: the last index where needle[q] can sit with the rest of the
  // query still fitting after it. Bounds every forward jump below.
  const latest = new Array<number>(needle.length)
  let bound = hay.length
  for (let q = needle.length - 1; q >= 0; q -= 1) {
    const at = hay.lastIndexOf(needle[q] as string, bound - 1)
    if (at === -1) return null
    latest[q] = at
    bound = at
  }

  const positions: number[] = []
  let from = 0
  for (let q = 0; q < needle.length; q += 1) {
    const ch = needle[q] as string
    const limit = latest[q] as number
    const first = hay.indexOf(ch, from)
    // Defensive: every earlier pick sits at or before its own latest slot,
    // which lies before latest[q], so a hit within the limit always exists.
    if (first === -1 || first > limit) return null
    let chosen = first
    // Prefer a word-start occurrence over a mid-word one, unless the mid-word
    // hit continues the previous character's run.
    const continues = positions.length > 0 && first === (positions.at(-1) as number) + 1
    if (!continues && !isBoundary(text, first)) {
      for (let i = hay.indexOf(ch, first + 1); i !== -1 && i <= limit; i = hay.indexOf(ch, i + 1)) {
        if (isBoundary(text, i)) {
          chosen = i
          break
        }
      }
    }
    positions.push(chosen)
    from = chosen + 1
  }
  // Letters scattered through the middle of words read as noise ("proof" in
  // "Suppress OTP Notification"). One mid-word run is allowed, which keeps
  // abbreviations like "qs" for "quickswitcher" working.
  let weakRuns = 0
  for (let i = 0; i < positions.length; i += 1) {
    const pos = positions[i] as number
    const runStart = i === 0 || pos !== (positions[i - 1] as number) + 1
    if (runStart && !isBoundary(text, pos)) weakRuns += 1
  }
  if (weakRuns > MAX_WEAK_RUNS) return null
  return scorePositions(text, hay, positions)
}

/** Score an alignment and collect its highlight ranges. */
function scorePositions(text: string, hay: string, positions: readonly number[]): Match {
  let score = 0
  const ranges: [number, number][] = []
  for (let i = 0; i < positions.length; i += 1) {
    const pos = positions[i] as number
    const prev = i === 0 ? -1 : positions[i - 1] as number
    score += SCORE_CHAR
    const consecutive = i > 0 && pos === prev + 1
    if (pos === 0) score += BONUS_START
    else if (!consecutive && isBoundary(text, pos)) score += i === 0 ? BONUS_BOUNDARY : BONUS_ACRONYM
    if (consecutive) {
      score += BONUS_CONSECUTIVE
      const last = ranges.at(-1) as [number, number]
      last[1] = pos + 1
    } else {
      if (i > 0) score -= Math.min(PENALTY_GAP_MAX, (pos - prev - 1) * PENALTY_GAP)
      ranges.push([pos, pos + 1])
    }
  }
  // Shorter texts win ties: the match covers more of what the row says.
  score -= hay.length * 0.01
  return { score, ranges }
}

/**
 * Lowercase without changing string length, so match positions index the
 * original text. The few characters whose lowercase form is longer (such as
 * U+0130) keep their original form.
 */
function lowerKeepingLength(text: string): string {
  const lower = text.toLowerCase()
  if (lower.length === text.length) return lower
  let out = ''
  for (const ch of text) {
    const l = ch.toLowerCase()
    out += l.length === ch.length ? l : ch
  }
  return out
}

/**
 * Split a query into whitespace-separated tokens.
 * @param query - raw input.
 * @returns non-empty tokens.
 */
export function tokenize(query: string): string[] {
  return query.trim().split(/\s+/).filter(token => token !== '')
}

/**
 * Merge overlapping or touching ranges.
 * @param ranges - ranges in any order.
 * @returns sorted, disjoint ranges.
 */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [start, end] of sorted) {
    const last = out.at(-1)
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}
