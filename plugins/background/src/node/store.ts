/**
 * The shared library's persistence: one JSON file per host.
 *
 * Writes go through a temp file and a rename so a crash can never leave a
 * half-written library, and every mutation is serialized through
 * {@link StateStore.update} so two browsers saving at once cannot interleave
 * their read-modify-write cycles.
 * @module
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { emptyState, normalizeState, type State } from '../shared/state.ts'

/**
 * Where the library lives by default: `<dsh home>/plugins/background/state.json`,
 * following the `~/.dsh/plugins/<name>/` convention other plugins use.
 * @param env - environment (reads `DSH_HOME`).
 * @param home - OS home directory.
 * @returns the absolute state file path.
 */
export function defaultStateFile(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  const configured = env.DSH_HOME?.trim()
  const dshHome = configured === undefined || configured === '' ? join(home, '.dsh') : configured
  return join(dshHome, 'plugins', 'background', 'state.json')
}

/** Loads, caches, and atomically saves the library. */
export class StateStore {
  readonly file: string
  private readonly log: (message: string) => void
  private state: State = emptyState()
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * @param file - absolute path of the state file.
   * @param log - warning sink (corrupt-file quarantine).
   */
  constructor(file: string, log: (message: string) => void = () => {}) {
    this.file = file
    this.log = log
  }

  /** The last loaded or saved state. */
  get current(): State {
    return this.state
  }

  /**
   * Read the file. Missing → empty state; unparseable → renamed aside to
   * `state.json.bad-<epochms>` and replaced by the empty state.
   * @returns the loaded state.
   */
  async load(): Promise<State> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      this.state = emptyState()
      return this.state
    }
    try {
      this.state = normalizeState(JSON.parse(text))
    } catch {
      const aside = `${this.file}.bad-${Date.now()}`
      await rename(this.file, aside).catch(() => {})
      this.log(`background: ${this.file} was not valid JSON; moved it to ${aside} and started empty`)
      this.state = emptyState()
    }
    return this.state
  }

  /**
   * Persist a state as the next revision.
   * @param next - the state to write (its revision is replaced).
   * @returns the saved state.
   */
  save(next: State): Promise<State> {
    return this.update(() => next)
  }

  /**
   * Serialized read-modify-write: `mutate` sees the latest saved state.
   * @param mutate - produces the next state from the current one.
   * @returns the saved state, with its revision bumped.
   */
  update(mutate: (current: State) => State): Promise<State> {
    const run = this.queue.then(async () => {
      const next = normalizeState({ ...mutate(this.state), revision: this.state.revision + 1 })
      await mkdir(dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp-${process.pid}-${Date.now()}`
      await writeFile(temp, JSON.stringify(next, null, 2) + '\n')
      await rename(temp, this.file)
      this.state = next
      return next
    })
    this.queue = run.catch(() => {})
    return run
  }
}
