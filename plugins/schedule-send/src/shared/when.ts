/**
 * Pure time resolution and formatting for the popover and dock.
 * Everything takes `now` explicitly so it tests without a clock.
 * @module
 */
import { MAX_AHEAD_MS } from './types.ts'

export type Unit = 'm' | 'h' | 'd'

const UNIT_MS: Record<Unit, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Shortest lead the popover accepts, so a message cannot be "scheduled" into the past while the user reads. */
export const MIN_LEAD_MS = 30_000

/**
 * Resolve a relative offset.
 * @returns the instant, or null for a non-positive or non-finite amount.
 */
export function resolveRelative(amount: number, unit: Unit, now: Date): Date | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  return new Date(now.getTime() + amount * UNIT_MS[unit])
}

/**
 * Resolve a local wall-clock day and time.
 * @param date - `YYYY-MM-DD`.
 * @param time - `HH:MM`.
 * @returns the instant in the runtime's local zone, or null when either part is malformed.
 */
export function resolveAbsolute(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (d === null || t === null) return null
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null
  const out = new Date(y, mo - 1, da, h, mi, 0, 0)
  // Reject rollovers such as Feb 31.
  if (out.getMonth() !== mo - 1 || out.getDate() !== da) return null
  return out
}

export type Validity = 'ok' | 'past' | 'too-far'

/** Whether a resolved target can be scheduled from `now`. */
export function validate(target: Date, now: Date): Validity {
  const lead = target.getTime() - now.getTime()
  if (lead < MIN_LEAD_MS) return 'past'
  if (lead > MAX_AHEAD_MS) return 'too-far'
  return 'ok'
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Whole local calendar days from `now` to `target` (DST-safe). */
export function dayOffset(target: Date, now: Date): number {
  return Math.round((startOfDay(target) - startOfDay(now)) / 86_400_000)
}

/**
 * "Today, 9:00 AM", "Tomorrow, 9:00 AM", or "Fri, Nov 13, 9:00 AM".
 */
export function formatAbsolute(target: Date, now: Date, locale?: string): string {
  const time = target.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const days = dayOffset(target, now)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Tomorrow, ${time}`
  const sameYear = target.getFullYear() === now.getFullYear()
  const day = target.toLocaleDateString(locale, sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${day}, ${time}`
}

/** "in 5 min", "in 3 hr 20 min", "in 4 days". */
export function formatRelative(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000))
  if (mins < 60) return `in ${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 48) return m === 0 ? `in ${h} hr` : `in ${h} hr ${m} min`
  return `in ${Math.round(h / 24)} days`
}

/** Local `YYYY-MM-DD` for a date input. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Local midnight `n` days from `now`. */
export function addDays(now: Date, n: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
}
