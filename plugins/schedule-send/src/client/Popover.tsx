/**
 * The schedule popover opened from the Send button.
 * @module
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  addDays, formatAbsolute, formatRelative, isoDate, resolveAbsolute, resolveRelative, validate, type Unit,
} from '../shared/when.ts'

type Mode = 'in' | 'at'

interface Prefs {
  mode: Mode
  amount: number
  unit: Unit
  time: string
}

const PREFS_KEY = 'dsh-schedule-send:prefs'
const DEFAULT_PREFS: Prefs = { mode: 'in', amount: 1, unit: 'h', time: '09:00' }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null
    if (raw === null || typeof raw !== 'object') return DEFAULT_PREFS
    return {
      mode: raw.mode === 'at' ? 'at' : 'in',
      amount: typeof raw.amount === 'number' && raw.amount > 0 ? raw.amount : DEFAULT_PREFS.amount,
      unit: raw.unit === 'm' || raw.unit === 'd' ? raw.unit : 'h',
      time: typeof raw.time === 'string' && /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : DEFAULT_PREFS.time,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // private mode or quota; not worth surfacing
  }
}

const IN_CHIPS: readonly { amount: number; unit: Unit; label: string }[] = [
  { amount: 30, unit: 'm', label: '30 min' },
  { amount: 1, unit: 'h', label: '1 hr' },
  { amount: 3, unit: 'h', label: '3 hr' },
  { amount: 1, unit: 'd', label: '1 day' },
]

const UNIT_LABELS: Record<Unit, string> = { m: 'minutes', h: 'hours', d: 'days' }

export interface PopoverProps {
  /** The Send button the popover hangs from. */
  anchor: HTMLElement
  /** Why the draft cannot be scheduled, if it cannot. */
  blocked: string | undefined
  /** Schedule at an instant. Resolves to an error message or undefined. */
  onSchedule(at: Date): Promise<string | undefined>
  onClose(): void
}

const GAP = 8
const MARGIN = 8

export function Popover({ anchor, blocked, onSchedule, onClose }: PopoverProps) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [date, setDate] = useState(() => isoDate(addDays(new Date(), 1)))
  const [now, setNow] = useState(() => new Date())
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>()
  const root = useRef<HTMLDivElement>(null)

  const update = (patch: Partial<Prefs>) => {
    setError(undefined)
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  }

  // Keep "in N min" honest while the popover stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [])

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      const width = root.current?.offsetWidth ?? 300
      const height = root.current?.offsetHeight ?? 220
      const left = Math.max(MARGIN, Math.min(rect.right - width, window.innerWidth - width - MARGIN))
      if (rect.top - GAP - height >= MARGIN) setPosition({ left, bottom: window.innerHeight - rect.top + GAP })
      else setPosition({ left, top: Math.min(rect.bottom + GAP, window.innerHeight - height - MARGIN) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, prefs.mode])

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      if (anchor.isConnected) anchor.focus({ preventScroll: true })
    }
  }, [anchor, onClose])

  const target = prefs.mode === 'in' ? resolveRelative(prefs.amount, prefs.unit, now) : resolveAbsolute(date, prefs.time)
  const validity = target === null ? 'past' : validate(target, now)
  const canSubmit = blocked === undefined && target !== null && validity === 'ok' && !busy

  const dayChips = useMemo(() => [0, 1, 2, 3, 4].map((n) => {
    const day = addDays(now, n)
    return {
      value: isoDate(day),
      label: n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : day.toLocaleDateString(undefined, { weekday: 'short' }),
    }
  }), [now.toDateString()])

  const submit = async () => {
    if (!canSubmit || target === null) return
    setBusy(true)
    const failure = await onSchedule(target)
    setBusy(false)
    if (failure === undefined) onClose()
    else setError(failure)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      void submit()
    }
  }

  let detail = ''
  if (blocked !== undefined) detail = blocked
  else if (error !== undefined) detail = error
  else if (target === null) detail = ''
  else if (validity === 'past') detail = 'That time has passed'
  else if (validity === 'too-far') detail = 'More than a year away'
  else detail = formatRelative(target.getTime() - now.getTime())
  const bad = blocked !== undefined || error !== undefined || validity !== 'ok'

  return createPortal(
    <div
      ref={root}
      className="dss-pop"
      role="dialog"
      aria-label="Schedule send"
      style={position === undefined ? { visibility: 'hidden', left: 0, top: 0 } : position}
      onKeyDown={onKeyDown}
    >
      <div className="dss-seg" role="group" aria-label="Schedule mode">
        <button type="button" aria-pressed={prefs.mode === 'in'} onClick={() => update({ mode: 'in' })}>In</button>
        <button type="button" aria-pressed={prefs.mode === 'at'} onClick={() => update({ mode: 'at' })}>At</button>
      </div>

      {prefs.mode === 'in' ? (
        <>
          <div className="dss-row">
            <input
              type="number"
              min={1}
              step={1}
              aria-label="Amount"
              value={Number.isFinite(prefs.amount) ? prefs.amount : ''}
              onChange={(e) => update({ amount: e.currentTarget.valueAsNumber })}
            />
            <select aria-label="Unit" value={prefs.unit} onChange={(e) => update({ unit: e.currentTarget.value as Unit })}>
              {(Object.keys(UNIT_LABELS) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
            </select>
          </div>
          <div className="dss-chips">
            {IN_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                aria-pressed={prefs.amount === c.amount && prefs.unit === c.unit}
                onClick={() => update({ amount: c.amount, unit: c.unit })}
              >{c.label}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="dss-chips">
            {dayChips.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={date === c.value}
                onClick={() => { setError(undefined); setDate(c.value) }}
              >{c.label}</button>
            ))}
          </div>
          <div className="dss-row">
            <input
              type="date"
              aria-label="Day"
              min={isoDate(now)}
              value={date}
              onChange={(e) => { setError(undefined); setDate(e.currentTarget.value) }}
            />
            <input type="time" aria-label="Time" value={prefs.time} onChange={(e) => update({ time: e.currentTarget.value })} />
          </div>
        </>
      )}

      <div className="dss-foot">
        <div className="dss-when" data-bad={bad ? '' : undefined} aria-live="polite">
          <b>{target === null ? 'Pick a time' : formatAbsolute(target, now)}</b>
          {detail === '' ? null : <span>{detail}</span>}
        </div>
        <button type="button" className="dss-go" disabled={!canSubmit} onClick={() => void submit()}>Schedule</button>
      </div>
    </div>,
    document.body,
  )
}
