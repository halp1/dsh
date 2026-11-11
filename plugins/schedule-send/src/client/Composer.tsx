/**
 * Slot entries: the invisible anchor that hooks Send and hosts the popover,
 * and the dock listing this Session's pending messages above the composer.
 * @module
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PendingSend } from '../shared/types.ts'
import { formatAbsolute } from '../shared/when.ts'
import type { QueueHub } from './api.ts'
import { Popover } from './Popover.tsx'
import { bindSendHook } from './send-hook.ts'

/** The input facts this plugin reads (a slice of the host's InputState). */
interface InputSlice {
  readonly draft: string
  readonly attachmentIds: readonly unknown[]
  readonly phase: string
}

/** Standard session-scope props the host passes to composer slot entries. */
export interface ComposerEntryProps {
  sessionId: string
  useInput: <S>(select: (state: InputSlice) => S, eq?: (a: S, b: S) => boolean) => S
  inputActions: { setDraft(text: string): void }
}

export interface Injected {
  hub: QueueHub
}

const timeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/** Why a draft cannot be scheduled, or undefined. */
export function blockedReason(draft: string, attachments: number): string | undefined {
  if (attachments > 0) return 'Attachments can’t be scheduled'
  if (draft.trimStart().startsWith('/')) return 'Commands can’t be scheduled'
  return undefined
}

export function SendAnchor({ sessionId, useInput, inputActions, hub }: ComposerEntryProps & Injected) {
  const anchor = useRef<HTMLSpanElement>(null)
  const draft = useInput((s) => s.draft)
  const attachments = useInput((s) => s.attachmentIds.length)
  const phase = useInput((s) => s.phase)
  const [button, setButton] = useState<HTMLButtonElement | null>(null)

  const live = useRef({ draft, phase })
  live.current = { draft, phase }

  useEffect(() => {
    const el = anchor.current
    if (el === null) return
    return bindSendHook(el, {
      canOpen: () => live.current.draft.trim() !== '' && live.current.phase === 'plain',
      open: setButton,
    })
  }, [])

  // A draft that empties or starts sending closes the popover.
  useEffect(() => {
    if (draft.trim() === '' || phase !== 'plain') setButton(null)
  }, [draft, phase])

  const close = useCallback(() => setButton(null), [])

  const schedule = async (at: Date): Promise<string | undefined> => {
    const text = live.current.draft
    try {
      const zone = timeZone()
      const item = await hub.api.create({ sessionId, text, sendAt: at.toISOString(), ...(zone === undefined ? {} : { clientTimeZone: zone }) })
      const queue = hub.get(sessionId)
      queue.patch((items) => [...items, item].sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt)))
      void queue.refresh()
      if (live.current.draft === text) inputActions.setDraft('')
      return undefined
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  return (
    <>
      <span ref={anchor} className="dss-anchor" aria-hidden="true" />
      {button === null ? null : (
        <Popover anchor={button} blocked={blockedReason(draft, attachments)} onSchedule={schedule} onClose={close} />
      )}
    </>
  )
}

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 4.75V8l2.25 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const EMPTY: readonly PendingSend[] = []

export function PendingDock({ sessionId, useInput, inputActions, hub }: ComposerEntryProps & Injected) {
  const queue = hub.get(sessionId)
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => EMPTY)
  const draft = useInput((s) => s.draft)
  const [busy, setBusy] = useState<string>()
  const [, tick] = useState(0)

  // Re-render each minute so "Today" rolls to the right day label.
  useEffect(() => {
    if (items.length === 0) return
    const timer = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(timer)
  }, [items.length])

  if (items.length === 0) return null

  const act = async (item: PendingSend, action: 'cancel' | 'sendNow' | 'retry') => {
    setBusy(item.id)
    try {
      if (action === 'cancel') {
        const removed = await hub.api.cancel(item.id)
        queue.patch((all) => all.filter((c) => c.id !== item.id))
        inputActions.setDraft(draft.trim() === '' ? removed.text : `${draft}\n\n${removed.text}`)
      } else {
        await hub.api[action](item.id)
        queue.patch((all) => all.filter((c) => c.id !== item.id || action === 'retry'))
      }
    } catch {
      // The row stays; the refresh below shows the host's truth.
    } finally {
      setBusy(undefined)
      void queue.refresh()
    }
  }

  const discard = async (item: PendingSend) => {
    setBusy(item.id)
    try {
      await hub.api.cancel(item.id)
      queue.patch((all) => all.filter((c) => c.id !== item.id))
    } catch {
      // see above
    } finally {
      setBusy(undefined)
      void queue.refresh()
    }
  }

  const now = new Date()
  return (
    <div className="dss-dock">
      <div className="dss-panel">
        <ul className="dss-list" aria-label="Scheduled messages">
          {items.map((item) => {
            const failed = item.status === 'failed'
            const disabled = busy === item.id
            return (
              <li key={item.id} className="dss-item" data-failed={failed ? '' : undefined}>
                <span className="dss-item-icon"><ClockIcon /></span>
                <span className="dss-item-when" title={failed ? item.lastError : new Date(item.sendAt).toLocaleString()}>
                  {failed ? 'Failed' : formatAbsolute(new Date(item.sendAt), now)}
                </span>
                <span className="dss-item-text" title={item.text}>{item.text}</span>
                <span className="dss-item-actions">
                  {failed ? (
                    <>
                      <button type="button" disabled={disabled} onClick={() => void act(item, 'retry')}>Retry</button>
                      <button type="button" disabled={disabled} onClick={() => void discard(item)}>Discard</button>
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={disabled} onClick={() => void act(item, 'sendNow')}>Send now</button>
                      <button type="button" disabled={disabled} onClick={() => void act(item, 'cancel')}>Cancel</button>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
