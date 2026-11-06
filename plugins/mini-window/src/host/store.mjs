import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { defaultState, normalizeState } from '../../shared/state.mjs'

export function expandHome(path, home = homedir()) {
  return path === '~' ? home : path.startsWith('~/') ? join(home, path.slice(2)) : path
}
export function defaultStateFile(env = process.env, home = homedir()) {
  return resolve(expandHome(env.DSH_HOME?.trim() || join(home, '.dsh'), home), 'plugins/mini-window/state.json')
}
export function userDataDirectory(file, profileDir) {
  const identity = createHash('sha256').update(profileDir || resolve(file)).digest('hex').slice(0, 16)
  return join(dirname(file), 'userData', identity)
}

/** Atomic private persistence. The controller serializes every call, including geometry. */
export class StateStore {
  constructor(file) { this.file = resolve(file); this.current = defaultState(); this.loading = null }
  load() {
    return this.loading ??= (async () => {
      let text
      try { text = await readFile(this.file, 'utf8') }
      catch (error) { if (error.code === 'ENOENT') return this.current; throw error }
      try { this.current = normalizeState(JSON.parse(text)) }
      catch { throw new Error('Mini-window settings are not valid JSON. Repair or remove the configured state file, then restart the plugin.') }
      await chmod(this.file, 0o600)
      return this.current
    })()
  }
  async save(value) {
    const next = normalizeState({ ...value, revision: this.current.revision + 1 })
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(temp, this.file)
      this.current = next
      return next
    } finally { await unlink(temp).catch(() => {}) }
  }
}
