import { spawn } from 'node:child_process'
import { access, chmod, cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const INSTALL_HELP = 'Electron is not installed. Run npm run setup:electron in this plugin package to install its runtime, or set mini-window.electronPath / ELECTRON_PATH to an installed Electron executable, then click Restart.'
export const stoppedRuntime = () => ({ status: 'stopped', visible: false, expanded: false, shortcutRegistered: false })

const executableIn = (dir, platform) => join(dir, platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron')
const executable = async path => { try { await access(path, constants.X_OK); return (await stat(path)).isFile() } catch { return false } }

/** The installed electron package (never imported: its index may download). */
async function electronPackage(anchors) {
  for (const anchor of anchors) {
    try {
      const file = createRequire(anchor).resolve('electron/package.json')
      const { version } = JSON.parse(await readFile(file, 'utf8'))
      return { dir: dirname(file), version: typeof version === 'string' && /^[\w.+-]+$/.test(version) ? version : undefined }
    } catch {}
  }
  return undefined
}

/** Copy a dist into the private runtime directory atomically (temp dir, then rename). */
async function adopt(dist, target) {
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  try {
    await cp(dist, temp, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true })
    await rename(temp, target).catch(async error => { if (error?.code !== 'ENOTEMPTY' && error?.code !== 'EEXIST') throw error })
  } finally { await rm(temp, { recursive: true, force: true }) }
}

/** Run the electron package's own installer (uses the shared download cache when present). */
export function runElectronInstaller(packageDir, env = process.env) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(packageDir, 'install.js')], { cwd: packageDir, stdio: 'ignore', env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true })
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('Electron install timed out.')) }, 300000)
    child.on('error', error => { clearTimeout(timer); fail(error) })
    child.on('exit', code => { clearTimeout(timer); code === 0 ? done() : fail(new Error(`Electron installer exited with code ${code}.`)) })
  })
}

/**
 * Find the Electron executable. DSH reinstalls profile packages with install
 * scripts disabled, which leaves `electron` without its `dist/` binary. So the
 * runtime is kept in a private, version-keyed directory (`runtimeDir`) that
 * profile reinstalls never touch, adopted from the package dist when present
 * and repaired with the package's own installer when it is missing.
 */
export async function resolveElectron({ electronPath, env = process.env, anchors = [], platform = process.platform, runtimeDir, install = runElectronInstaller } = {}) {
  const explicit = electronPath?.trim() || env.ELECTRON_PATH?.trim()
  if (explicit) {
    const path = resolve(explicit)
    if (await executable(path)) return path
    throw new Error('Configured Electron executable is missing or not executable. Correct mini-window.electronPath / ELECTRON_PATH, then click Restart.')
  }
  const pkg = await electronPackage(anchors)
  if (!pkg) throw new Error(INSTALL_HELP)
  const dist = join(pkg.dir, 'dist')
  const packaged = executableIn(dist, platform)
  if (!runtimeDir || !pkg.version) {
    if (await executable(packaged)) return packaged
    throw new Error(INSTALL_HELP)
  }
  const target = join(runtimeDir, pkg.version)
  const kept = executableIn(target, platform)
  if (await executable(kept)) return kept
  try {
    if (!await executable(packaged)) await install(pkg.dir, env)
    if (!await executable(packaged)) throw new Error('installer produced no executable')
    await adopt(dist, target)
    if (await executable(kept)) return kept
    return packaged
  } catch (error) {
    if (await executable(packaged)) return packaged
    throw new Error(`Electron ${pkg.version} could not be installed automatically (${error instanceof Error ? error.message : String(error)}). Check your network, then click Restart.`)
  }
}

/** Never expose bootstrap credentials, including tokens echoed alone by a child. */
export function sanitizeError(error, secretURL = '') {
  let message = error instanceof Error ? error.message : String(error)
  const secrets = new Set(secretURL ? [secretURL] : [])
  try { for (const value of new URL(secretURL).searchParams.values()) if (value) secrets.add(value) } catch {}
  for (const secret of secrets) {
    for (const encoded of [secret, encodeURIComponent(secret)]) message = message.split(encoded).join('[redacted]')
  }
  return message.replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted URL]').slice(0, 1500)
}

/** One child per host, bounded JSON-line transport, no automatic restart loop. */
export class NativeRuntime {
  constructor(options) {
    this.options = options
    this.runtime = stoppedRuntime()
    this.child = null
    this.starting = null
    this.stopping = null
    this.disposed = false
    this.pending = new Map()
    this.nextId = 1
    this.secretURL = ''
    this.readyWaiter = null
  }
  error(error) {
    const message = sanitizeError(error, this.secretURL)
    this.runtime = { ...stoppedRuntime(), expanded: this.runtime.expanded, status: 'error', error: message }
    return new Error(message)
  }
  updateRuntime(value, ready = false) {
    if (!value || typeof value !== 'object') value = {}
    const next = { ...this.runtime }
    if (ready) next.status = 'ready'
    else if (['starting', 'ready', 'error'].includes(value.status)) next.status = value.status
    for (const key of ['visible', 'expanded', 'shortcutRegistered']) if (typeof value[key] === 'boolean') next[key] = value[key]
    if (typeof value.error === 'string') { next.error = sanitizeError(value.error, this.secretURL) }
    else if (next.status !== 'error') delete next.error
    this.runtime = next
  }
  start(settings) {
    if (this.disposed) return Promise.reject(new Error('Mini-window plugin has been disposed.'))
    if (this.starting) return this.starting
    if (this.child && this.runtime.status === 'ready') return Promise.resolve(this.runtime)
    const run = this.startChild(settings)
    this.starting = run
    run.finally(() => { if (this.starting === run) this.starting = null }).catch(() => {})
    return run
  }
  async startChild(settings) {
    try {
      if (this.stopping) await this.stopping
      if (this.child) await this.stop()
      this.runtime = { ...stoppedRuntime(), status: 'starting', expanded: settings.expanded }
      const executable = await (this.options.resolveExecutable || resolveElectron)(this.options)
      try { await access(this.options.mainPath) }
      catch { throw new Error('Mini-window native/main.cjs is missing. Rebuild or reinstall this plugin, then click Restart.') }
      await mkdir(this.options.userDataDir, { recursive: true, mode: 0o700 })
      await chmod(this.options.userDataDir, 0o700)
      if (this.disposed) throw new Error('Mini-window plugin has been disposed.')
      this.secretURL = this.options.authenticatedUrl()
      const env = { ...process.env, ...this.options.env }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_ENABLE_LOGGING
      delete env.ELECTRON_LOG_FILE
      delete env.ELECTRON_ENABLE_STACK_DUMPING
      const child = (this.options.spawn || spawn)(executable, [this.options.mainPath], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true })
      this.child = child
      let buffer = ''
      child.stdout.setEncoding('utf8')
      // Consume stderr without storing or logging it: it can contain authenticated URLs.
      child.stderr.on('data', () => {})
      child.stdout.on('data', (chunk) => {
        if (this.child !== child) return
        buffer += chunk
        const cap = this.options.maxFrameBytes || 262144
        if (Buffer.byteLength(buffer) > cap) { this.failChild(child, 'Native companion exceeded the protocol frame limit. Click Restart.'); return }
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          if (!line.trim()) continue
          let frame
          try { frame = JSON.parse(line) } catch { continue } // Electron can emit non-protocol diagnostics.
          this.frame(child, frame)
        }
      })
      child.stdin.on('error', (error) => this.failChild(child, error))
      child.on('error', (error) => this.failChild(child, error))
      const onExit = (code, signal) => {
        if (this.child !== child) return
        this.child = null
        const error = new Error(this.stopping || this.disposed ? 'Native companion stopped.' : `Native companion exited (${signal || code}). Click Restart to try again.`)
        this.rejectPending(error)
        this.readyWaiter?.reject(error)
        if (!this.stopping && !this.disposed && this.runtime.status !== 'error') this.error(error)
      }
      child.once('exit', onExit)
      // Failed spawns can emit error + close without an exit event.
      child.once('close', onExit)
      const ready = new Promise((resolve, reject) => { this.readyWaiter = { resolve, reject } })
      const timer = setTimeout(() => this.failChild(child, 'Native companion startup timed out. Check Electron installation and macOS permissions, then click Restart.'), this.options.startupTimeoutMs || 15000)
      try {
        child.stdin.write(JSON.stringify({ type: 'bootstrap', url: this.secretURL, settings, userDataDir: this.options.userDataDir }) + '\n')
        await ready
      } finally { clearTimeout(timer); this.readyWaiter = null }
      return this.runtime
    } catch (error) {
      const safe = this.error(error)
      if (this.child) await this.stop(true)
      throw safe
    }
  }
  frame(child, frame) {
    if (!frame || typeof frame !== 'object' || this.child !== child) return
    if (frame.type === 'ready') {
      this.updateRuntime(frame.runtime, true)
      this.readyWaiter?.resolve(this.runtime)
    } else if (frame.type === 'status') {
      this.updateRuntime(frame.runtime)
      if (this.readyWaiter && frame.runtime?.status === 'error') this.failChild(child, frame.runtime.error || 'Native companion failed to start. Click Restart.')
    } else if (frame.type === 'geometry') this.options.onGeometry?.(frame.patch)
    else if (frame.type === 'response') {
      const pending = this.pending.get(frame.id)
      if (!pending) return
      this.pending.delete(frame.id); clearTimeout(pending.timer)
      if (frame.ok === true) {
        if (frame.result) this.updateRuntime(frame.result)
        pending.resolve(this.runtime)
      } else pending.reject(new Error(sanitizeError(frame.error || 'Native command failed.', this.secretURL)))
    }
  }
  failChild(child, reason) {
    if (this.child !== child) return
    const error = this.error(reason)
    this.readyWaiter?.reject(error)
    this.rejectPending(error)
    child.kill('SIGTERM')
    // Protocol violations must not leave a hung child holding the shortcut.
    const timer = setTimeout(() => { if (this.child === child) child.kill('SIGKILL') }, this.options.stopTimeoutMs || 2000)
    timer.unref?.()
    child.once('exit', () => clearTimeout(timer))
    child.once('close', () => clearTimeout(timer))
  }
  rejectPending(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(sanitizeError(error, this.secretURL))) }
    this.pending.clear()
  }
  command(command, settings) {
    if (!['configure', 'show', 'hide', 'quit'].includes(command)) return Promise.reject(new Error('Unknown native command.'))
    const child = this.child
    if (!child || (this.runtime.status !== 'ready' && command !== 'quit')) return Promise.reject(new Error(this.runtime.error || 'Native companion is not running. Click Restart.'))
    if (this.pending.size >= 64) return Promise.reject(new Error('Native companion is busy. Try again.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // A timed-out configure has uncertain outcome. Kill the child rather than
        // permit a late shortcut change to disagree with persisted settings.
        this.failChild(child, 'Native companion command timed out. Click Restart.')
        reject(new Error('Native companion command timed out. Click Restart.'))
      }, this.options.commandTimeoutMs || 5000)
      this.pending.set(id, { resolve, reject, timer })
      try { child.stdin.write(JSON.stringify({ id, command, ...(settings ? { settings } : {}) }) + '\n') }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(new Error(sanitizeError(error, this.secretURL))) }
    })
  }
  stop(preserveError = false) {
    if (this.stopping) return this.stopping
    const child = this.child
    if (!child) { if (!preserveError) this.runtime = stoppedRuntime(); return Promise.resolve() }
    const run = (async () => {
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), this.options.stopTimeoutMs || 2000)
        const finish = () => { clearTimeout(timer); resolve() }
        child.once('exit', finish)
        child.once('close', finish)
        // Do not wait for a response; quit is permitted to exit before acknowledging.
        try { child.stdin.write(JSON.stringify({ id: this.nextId++, command: 'quit' }) + '\n') }
        catch { child.kill('SIGTERM') }
      })
      this.rejectPending(new Error('Native companion stopped.'))
      if (!preserveError) this.runtime = stoppedRuntime()
    })()
    this.stopping = run
    run.finally(() => { if (this.stopping === run) this.stopping = null }).catch(() => {})
    return run
  }
  async dispose() {
    this.disposed = true
    // A start may still be resolving Electron or creating the profile directory.
    await this.stop()
    await this.starting?.catch(() => {})
    await this.stop()
  }
}
