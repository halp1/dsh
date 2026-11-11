/**
 * Wire and storage shapes shared by both halves.
 * @module
 */

/** One message waiting for its time. */
export interface PendingSend {
  /** Random identity, also used as the prompt `requestId` so delivery is idempotent. */
  readonly id: string
  readonly sessionId: string
  readonly text: string
  /** RFC 3339 UTC instant. */
  readonly sendAt: string
  readonly clientTimeZone?: string
  readonly createdAt: string
  readonly status: 'pending' | 'failed'
  readonly attempts: number
  readonly lastError?: string
}

/** The persisted queue file. */
export interface QueueFile {
  readonly version: 1
  readonly items: readonly PendingSend[]
}

/** `POST create` body. */
export interface CreateRequest {
  readonly sessionId: string
  readonly text: string
  readonly sendAt: string
  readonly clientTimeZone?: string
}

export const API = {
  list: '/api/dsh-schedule-send.list',
  create: '/api/dsh-schedule-send.create',
  cancel: '/api/dsh-schedule-send.cancel',
  sendNow: '/api/dsh-schedule-send.send-now',
  retry: '/api/dsh-schedule-send.retry',
} as const

/** Longest accepted message, in UTF-16 code units. */
export const MAX_TEXT = 200_000
/** A create may name a time this far in the past (clock skew, slow submit) and still be accepted. */
export const PAST_GRACE_MS = 60_000
/** Furthest accepted schedule. */
export const MAX_AHEAD_MS = 366 * 86_400_000
