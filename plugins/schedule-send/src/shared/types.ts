/**
 * Wire and storage shapes shared by both halves.
 * @module
 */

/** Description of one stored attachment; the bytes live beside the queue file. */
export interface AttachmentMeta {
  /** `image` is inlined into the prompt; `file` is uploaded for a receipt at delivery. */
  readonly kind: 'image' | 'file'
  readonly name: string
  /** Browser-declared MIME type (required for images). */
  readonly mediaType: string
  readonly size: number
}

/** One message waiting for its time. */
export interface PendingSend {
  /** Random identity, also used as the prompt `requestId` so delivery is idempotent. */
  readonly id: string
  readonly sessionId: string
  /** May be empty when the message is attachments only. */
  readonly text: string
  readonly attachments?: readonly AttachmentMeta[]
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

/** One attachment in a create request: its description plus base64 bytes. */
export interface AttachmentUpload extends Omit<AttachmentMeta, 'size'> {
  readonly data: string
}

/** `POST create` body. */
export interface CreateRequest {
  readonly sessionId: string
  readonly text: string
  readonly attachments?: readonly AttachmentUpload[]
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

/** Image types the host accepts inline in a prompt. */
export const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Longest accepted message, in UTF-16 code units. */
export const MAX_TEXT = 200_000
export const MAX_ATTACHMENTS = 20
/** Total decoded attachment bytes per message. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
/** A create may name a time this far in the past (clock skew, slow submit) and still be accepted. */
export const PAST_GRACE_MS = 60_000
/** Furthest accepted schedule. */
export const MAX_AHEAD_MS = 366 * 86_400_000
