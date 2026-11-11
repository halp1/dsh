/**
 * The pending queue's persistence: one JSON file per host.
 *
 * Writes go through a temp file and a rename, and every mutation is
 * serialized through {@link QueueStore.update}.
 * @module
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PendingSend, QueueFile } from '../shared/types.ts'

/**
 * `<dsh home>/plugins/schedule-send/queue.json`.
 * @param env - environment (reads `DSH_HOME`).
 * @param home - OS home directory.
 */
export function defaultQueueFile(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  const configured = env.DSH_HOME?.trim()
  const dshHome = configured === undefined || configured === '' ? join(home, '.dsh') : configured
  return join(dshHome, 'plugins', 'schedule-send', 'queue.json')
}

function isItem(value: unknown): value is PendingSend {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.sessionId === 'string' && typeof v.text === 'string'
    && typeof v.sendAt === 'string' && !Number.isNaN(Date.parse(v.sendAt))
    && (v.status === 'pending' || v.status === 'failed') && typeof v.attempts === 'number'
}

function normalize(raw: unknown): PendingSend[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as QueueFile).items)) throw new Error('not a queue file')
  return (raw as QueueFile).items.filter(isItem)
}

export class QueueStore {
  readonly file: string
  private readonly log: (message: string) => void
  private items: readonly PendingSend[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(file: string, log: (message: string) => void = () => {}) {
    this.file = file
    this.log = log
  }

  get current(): readonly PendingSend[] {
    return this.items
  }

  /** Missing file starts empty. Unparseable file is moved aside to `queue.json.bad-<ms>`. */
  async load(): Promise<readonly PendingSend[]> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      this.items = []
      return this.items
    }
    try {
      this.items = normalize(JSON.parse(text))
    } catch {
      const aside = `${this.file}.bad-${Date.now()}`
      await rename(this.file, aside).catch(() => {})
      this.log(`schedule-send: ${this.file} was not a valid queue; moved it to ${aside} and started empty`)
      this.items = []
    }
    return this.items
  }

  /**
   * Serialized read-modify-write.
   * @param mutate - next items from the latest saved items.
   */
  update(mutate: (current: readonly PendingSend[]) => readonly PendingSend[]): Promise<readonly PendingSend[]> {
    const run = this.queue.then(async () => {
      const next = mutate(this.items)
      if (next === this.items) return next
      const body: QueueFile = { version: 1, items: next }
      await mkdir(dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp-${process.pid}-${Date.now()}`
      await writeFile(temp, JSON.stringify(body, null, 2) + '\n')
      await rename(temp, this.file)
      this.items = next
      return next
    })
    this.queue = run.catch(() => {})
    return run
  }
}
