/**
 * Read and restore a draft's attachments through the Session's
 * `conversation` service, the same object the composer uses.
 *
 * The composer keeps each attachment as a browser `File`. Scheduling encodes
 * those bytes for the host; cancelling turns them back into `File`s and hands
 * them to the composer's own `addFiles`.
 * @module
 */
import type { AttachmentUpload } from '../shared/types.ts'
import { IMAGE_TYPES } from '../shared/types.ts'

interface DraftAttachment {
  readonly kind: 'image' | 'file'
  readonly id: string
  readonly file: File
}

/** The slice of the per-Session conversation service this plugin calls. */
export interface ConversationLike {
  resolveDraftAttachments(ids: readonly string[]): readonly DraftAttachment[]
  releaseDraftAttachment(id: string): void
  createDrafts(sessionId: string, files: readonly File[], uploadImages: boolean): readonly DraftAttachment[]
  releaseDraftAttachments(attachments: readonly DraftAttachment[]): void
}

/** The composer's public input actions this plugin calls. */
export interface InputActionsLike {
  setDraft(text: string): void
  addAttachments(ids: readonly string[]): boolean
  removeAttachment(id: string): void
}

/** The slice of the client `sessions` service this plugin calls. */
export interface SessionsLike {
  scope(id: string): { get(name: string): unknown } | undefined
}

/** Base64 of a blob, chunked so large files do not overflow the call stack. */
export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** Bytes back into a `File`. */
export function fileOf(data: string, name: string, mediaType: string): File {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], name === '' ? 'attachment' : name, mediaType === '' ? {} : { type: mediaType })
}

export interface DraftAccess {
  /** Encode the given draft attachments for the host. Throws when one is gone. */
  encode(ids: readonly string[]): Promise<AttachmentUpload[]>
  /** Drop the given attachments from the draft after scheduling. */
  release(ids: readonly string[]): void
  /** Put attachments back into the draft. Resolves to false when the composer refused them. */
  restore(attachments: readonly AttachmentUpload[]): boolean
}

/**
 * Bind draft access for one Session.
 * @param sessions - client sessions service.
 * @param sessionId - the composer's Session.
 * @param input - the composer's input actions.
 */
export function draftAccess(sessions: SessionsLike | undefined, sessionId: string, input: InputActionsLike): DraftAccess {
  const conversation = (): ConversationLike => {
    const found = sessions?.scope(sessionId)?.get('conversation') as ConversationLike | undefined
    if (found === undefined) throw new Error('attachments are unavailable in this session')
    return found
  }
  return {
    async encode(ids) {
      if (ids.length === 0) return []
      const attachments = conversation().resolveDraftAttachments(ids)
      if (attachments.length !== ids.length) throw new Error('an attachment is no longer available')
      return Promise.all(attachments.map(async (a) => {
        const image = a.kind === 'image' && IMAGE_TYPES.includes(a.file.type)
        return {
          kind: image ? 'image' as const : 'file' as const,
          name: a.file.name,
          mediaType: a.file.type,
          data: await base64Of(a.file),
        }
      }))
    },
    release(ids) {
      if (ids.length === 0) return
      const conv = conversation()
      for (const id of ids) {
        input.removeAttachment(id)
        conv.releaseDraftAttachment(id)
      }
    },
    restore(attachments) {
      if (attachments.length === 0) return true
      const conv = conversation()
      const drafts = conv.createDrafts(sessionId, attachments.map((a) => fileOf(a.data, a.name, a.mediaType)), true)
      if (input.addAttachments(drafts.map((d) => d.id))) return true
      conv.releaseDraftAttachments(drafts)
      return false
    },
  }
}
