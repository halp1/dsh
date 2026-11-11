/**
 * One timer for the whole queue. When it fires, every due pending item is
 * delivered in `sendAt` order through the injected `deliver` function.
 *
 * Delivery happens before removal. The item id is the prompt's `requestId`,
 * which the host deduplicates, so a crash between the two cannot send twice.
 * @module
 */
import type { PendingSend } from '../shared/types.ts'
import type { QueueStore } from './store.ts'

/** Longest delay `setTimeout` accepts. */
export const MAX_TIMER_MS = 2 ** 31 - 1
/** Attempts before an item is marked failed. */
export const MAX_ATTEMPTS = 5
/** Delay before retry `n` (1-based): 1, 2, 4, 8 minutes. */
export const backoffMs = (attempt: number): number => 60_000 * 2 ** (attempt - 1)

/** Delivery failure that retrying cannot fix (the session is gone). */
export class PermanentDeliveryError extends Error {}

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface SchedulerOptions {
  store: QueueStore
  deliver: (item: PendingSend) => Promise<void>
  /** Cleanup after an item is delivered and removed from the queue. */
  delivered?: (item: PendingSend) => Promise<void>
  clock?: Clock
  log?: (message: string) => void
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

export class Scheduler {
  private readonly store: QueueStore
  private readonly deliver: (item: PendingSend) => Promise<void>
  private readonly delivered: (item: PendingSend) => Promise<void>
  private readonly clock: Clock
  private readonly log: (message: string) => void
  private timer: unknown
  private running: Promise<void> | undefined
  private again = false
  private stopped = false

  constructor(options: SchedulerOptions) {
    this.store = options.store
    this.deliver = options.deliver
    this.delivered = options.delivered ?? (async () => {})
    this.clock = options.clock ?? systemClock
    this.log = options.log ?? (() => {})
  }

  /** Recompute the timer from the current queue. Call after every change. */
  arm(): void {
    if (this.stopped) return
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
    let next = Infinity
    for (const item of this.store.current) {
      if (item.status === 'pending') next = Math.min(next, Date.parse(item.sendAt))
    }
    if (next === Infinity) return
    const delay = Math.max(0, Math.min(MAX_TIMER_MS, next - this.clock.now()))
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      void this.drain()
    }, delay)
  }

  /** Deliver everything due now. Concurrent calls coalesce into one extra pass. */
  drain(): Promise<void> {
    if (this.running !== undefined) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.pass()
        } while (this.again && !this.stopped)
      } finally {
        this.running = undefined
        this.arm()
      }
    })()
    return this.running
  }

  private async pass(): Promise<void> {
    const now = this.clock.now()
    const due = this.store.current
      .filter((item) => item.status === 'pending' && Date.parse(item.sendAt) <= now)
      .sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt))
    for (const item of due) {
      if (this.stopped) return
      // Cancelled while an earlier item was delivering.
      if (!this.store.current.some((c) => c.id === item.id && c.status === 'pending')) continue
      try {
        await this.deliver(item)
        await this.store.update((items) => items.filter((c) => c.id !== item.id))
        await this.delivered(item).catch((error) => this.log(`schedule-send: cleanup of ${item.id} failed: ${errorText(error)}`))
      } catch (error) {
        const attempts = item.attempts + 1
        const permanent = error instanceof PermanentDeliveryError || attempts >= MAX_ATTEMPTS
        this.log(`schedule-send: delivery of ${item.id} failed (attempt ${attempts}): ${errorText(error)}`)
        await this.store.update((items) => items.map((c) => c.id !== item.id ? c : {
          ...c,
          attempts,
          lastError: errorText(error),
          ...(permanent
            ? { status: 'failed' as const }
            : { sendAt: new Date(this.clock.now() + backoffMs(attempts)).toISOString() }),
        }))
      }
    }
  }

  /** Stop the timer and wait for an in-flight delivery. */
  async dispose(): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
    await this.running
  }
}
