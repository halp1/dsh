'use strict'

const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen, shell, dialog, systemPreferences } = require('electron')
// Electron's failed-load warnings include the requested URL. Suppress implicit warning/log
// printers; sanitized load errors are delivered through our structured status protocol instead.
process.removeAllListeners('warning')
app.commandLine.appendSwitch('disable-logging')
const path = require('node:path')
const fs = require('node:fs')
const readline = require('node:readline')
const { pathToFileURL } = require('node:url')
const { originOf, isTrustedURL, isTrustedSender, externalURL, localCommand } = require('./security.cjs')
const { installMicrophonePolicy } = require('./permissions.cjs')

const channels = { hide: 'dsh-mini:hide', expanded: 'dsh-mini:set-expanded', getState: 'dsh-mini:get-state', state: 'dsh-mini:state', command: 'dsh-mini:command', external: 'dsh-mini:open-external', drag: 'dsh-mini:drag' }
let settings, trustedOrigin, authenticatedURL, win, activeShortcut = null
let stateHelpers, geometry, shortcuts, loading = null, quitting = false, initialized = false
let registrationError = null, windowError = null, loadFailed = false
let geometryTimer = null, parentTimer = null, lastGeometry = null
let desiredVisible = false, visibilityGeneration = 0
let drag = null
let queue = Promise.resolve()
const parentPID = process.ppid

// The sole stdout writer: do not log bootstrap URLs or Electron errors (which can contain tokens).
function output(message) {
  if (!process.stdout.destroyed && process.stdout.writable) process.stdout.write(`${JSON.stringify(message)}\n`)
}
function runtime() {
  const result = { status: 'ready', visible: Boolean(win && !win.isDestroyed() && win.isVisible()), expanded: Boolean(settings?.expanded), shortcutRegistered: Boolean(activeShortcut) }
  if (windowError || registrationError) result.error = windowError || registrationError
  return result
}
function rendererState() { const current = runtime(); return { expanded: current.expanded, visible: current.visible } }
function publishState() {
  if (initialized && !quitting) output({ type: 'status', runtime: runtime() })
  if (win && !win.isDestroyed() && isTrustedURL(win.webContents.getURL(), trustedOrigin)) win.webContents.send(channels.state, rendererState())
}
function report(message) { windowError = message; publishState() }
function safeAction(action) { Promise.resolve().then(action).catch(() => report('The mini window could not complete this action. Try showing it again.')) }
function displayFor(bounds) { return bounds ? screen.getDisplayMatching(bounds) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) }
function rememberGeometry() {
  clearTimeout(geometryTimer)
  geometryTimer = null
  if (!win || win.isDestroyed()) return
  const patch = geometry.geometryPatch(win.getBounds(), settings.expandedBounds, settings.expanded)
  Object.assign(settings, patch)
  const fingerprint = JSON.stringify(patch)
  if (fingerprint !== lastGeometry && initialized && !quitting) { lastGeometry = fingerprint; output({ type: 'geometry', patch }) }
}
function scheduleGeometry() { clearTimeout(geometryTimer); geometryTimer = setTimeout(rememberGeometry, 100) }
function applyBounds(bounds) {
  const area = displayFor(bounds).workArea
  const next = geometry.clampBounds(bounds, area)
  // Relax the old minimum before collapsing, or Electron keeps the expanded minimum height.
  win.setMinimumSize(1, 1)
  win.setResizable(Boolean(settings.expanded))
  win.setBounds(next, false)
  if (settings.expanded) win.setMinimumSize(Math.min(stateHelpers.MIN_EXPANDED_SIZE.width, area.width), Math.min(stateHelpers.MIN_EXPANDED_SIZE.height, area.height))
  else win.setMinimumSize(next.width, next.height)
  rememberGeometry()
}
function clampWindow() {
  if (!win || win.isDestroyed()) return
  applyBounds(win.getBounds())
  if (settings.expandedBounds) settings.expandedBounds = geometry.clampBounds(settings.expandedBounds, displayFor(settings.expandedBounds).workArea)
  rememberGeometry()
}
function setExpanded(expanded) {
  if (typeof expanded !== 'boolean') throw new Error('Expanded must be a boolean.')
  if (settings.expanded === expanded) return rendererState()
  if (win && !win.isDestroyed()) {
    rememberGeometry()
    const current = win.getBounds()
    settings.expanded = expanded
    applyBounds(geometry.boundsForMode(current, settings.expandedBounds, expanded, displayFor(current).workArea))
  } else { settings.expanded = expanded }
  buildMenus()
  publishState()
  return rendererState()
}
// The page drags the window itself instead of using -webkit-app-region: drag,
// because macOS swallows double-clicks on native drag regions; the page needs
// them to toggle expanded mode from the title bar.
function endDrag() {
  if (!drag) return
  clearInterval(drag.timer); clearTimeout(drag.deadline)
  drag = null
  scheduleGeometry()
}
function beginDrag() {
  endDrag()
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const cursor = screen.getCursorScreenPoint()
  const [x, y] = win.getPosition()
  const state = { dx: cursor.x - x, dy: cursor.y - y, x, y }
  state.timer = setInterval(() => {
    if (!win || win.isDestroyed()) { endDrag(); return }
    const point = screen.getCursorScreenPoint()
    const nx = point.x - state.dx, ny = point.y - state.dy
    if (nx !== state.x || ny !== state.y) { state.x = nx; state.y = ny; win.setPosition(nx, ny, false) }
  }, 8)
  // A missed pointerup must never leave the window glued to the cursor.
  state.deadline = setTimeout(endDrag, 30000)
  drag = state
}
function installNavigationPolicy(window) {
  window.webContents.on('will-navigate', (event, url) => { if (!isTrustedURL(url || event.url, trustedOrigin)) event.preventDefault() })
  window.webContents.on('will-redirect', (event, url) => { if (!isTrustedURL(url || event.url, trustedOrigin)) event.preventDefault() })
  window.webContents.on('will-frame-navigate', event => { if (!isTrustedURL(event.url, trustedOrigin)) event.preventDefault() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.on('before-input-event', (event, input) => {
    const command = localCommand(input)
    if (!command) return // Escape belongs to renderer menus, not this native host.
    event.preventDefault()
    if (input.isAutoRepeat) return
    if (command === 'hide') hideWindow()
    else window.webContents.send(channels.command, command)
  })
  installMicrophonePolicy(window, trustedOrigin, { dialog, systemPreferences, isEnabled: () => settings.enabled && !quitting, report })
  window.webContents.on('did-finish-load', () => {
    if (isTrustedURL(window.webContents.getURL(), trustedOrigin)) { loadFailed = false; windowError = null }
    publishState()
  })
  window.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { loadFailed = true; report('Could not load the DSH mini window. Check that the parent DSH server is still running; show it again to retry.') }
  })
  window.webContents.on('render-process-gone', () => { loadFailed = true; report('The mini window renderer stopped. Hide and show the window to reload it.') })
}
function loadWindow(window) {
  loadFailed = false
  loading = window.loadURL(authenticatedURL).catch(() => {
    loadFailed = true
    report('Could not load DSH. Check that the parent DSH server is running; show the mini window again to retry.')
  }).finally(() => { loading = null })
  return loading
}
async function ensureWindow() {
  if (win && !win.isDestroyed()) { if (loading) await loading; return win }
  const area = displayFor(settings.expanded ? settings.expandedBounds || settings.bounds : settings.bounds).workArea
  const bounds = geometry.initialBounds(settings, area)
  const window = new BrowserWindow({
    ...bounds, show: false, title: 'DSH Mini', frame: false, transparent: true,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    backgroundColor: '#00000000', hasShadow: false,
    acceptFirstMouse: true, skipTaskbar: true,
    resizable: Boolean(settings.expanded), fullscreenable: false,
    maximizable: false, minimizable: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, safeDialogs: true, navigateOnDragDrop: false },
  })
  win = window
  // Keep a stable, mini-specific AX title so window switchers can exclude only this
  // Electron surface rather than every Electron window (including the DSH browser).
  window.webContents.on('page-title-updated', event => { event.preventDefault(); window.setTitle('DSH Mini') })
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  installNavigationPolicy(window)
  window.on('move', scheduleGeometry)
  window.on('resize', scheduleGeometry)
  window.on('show', publishState)
  window.on('hide', () => { endDrag(); publishState() })
  window.on('blur', endDrag)
  window.on('close', event => { if (!quitting) { event.preventDefault(); hideWindow() } })
  window.on('closed', () => { if (win === window) { cancelShow(); win = null; loading = null; publishState() } })
  applyBounds(bounds)
  // A failed initial load still leaves a window available from the menu; the token is never returned in errors.
  await loadWindow(window)
  return window
}
function cancelShow() { desiredVisible = false; visibilityGeneration++ }
async function showWindow() {
  if (!settings.enabled) throw new Error('The mini window is disabled. Enable it in Settings first.')
  if (quitting) return runtime()
  desiredVisible = true
  const request = ++visibilityGeneration
  const existing = win && !win.isDestroyed()
  const window = await ensureWindow()
  const stillWanted = () => desiredVisible && request === visibilityGeneration && !quitting && settings.enabled && window && win === window && !window.isDestroyed()
  if (!stillWanted()) return runtime()
  // Existing geometry was clamped on creation, resize, and display changes.
  // Re-clamping every toggle makes the shortcut feel sluggish on macOS.
  if (!existing) clampWindow()
  if (existing && (loadFailed || window.webContents.isCrashed?.())) await loadWindow(window)
  if (!stillWanted()) return runtime()
  window.show()
  window.focus()
  publishState()
  return runtime()
}
function hideWindow() {
  cancelShow()
  if (win && !win.isDestroyed()) { rememberGeometry(); win.hide() }
  publishState()
  return runtime()
}
async function sendCommand(command) {
  const pendingShow = showWindow()
  const request = visibilityGeneration
  await pendingShow
  if (desiredVisible && request === visibilityGeneration && !quitting && settings.enabled && runtime().visible && isTrustedURL(win.webContents.getURL(), trustedOrigin)) win.webContents.send(channels.command, command)
}
function toggleWindow() { return desiredVisible || runtime().visible ? hideWindow() : showWindow() }
function updateShortcut(next) {
  const result = shortcuts.replaceShortcut(globalShortcut, activeShortcut, next, () => safeAction(toggleWindow))
  activeShortcut = result.activeShortcut
  registrationError = result.ok ? null : result.error
  return result
}
function configure(value) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Expected settings.')
  if (value?.shortcut !== undefined) stateHelpers.validateShortcut(value.shortcut)
  if (value?.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('Enabled must be a boolean.')
  if (value?.expanded !== undefined && typeof value.expanded !== 'boolean') throw new Error('Expanded must be a boolean.')
  const next = stateHelpers.normalizeState({ ...settings, ...value })
  const shortcut = updateShortcut(next.enabled ? next.shortcut : null)
  if (!shortcut.ok) { publishState(); throw new Error(shortcut.error) }
  const modeChanged = next.expanded !== settings.expanded
  const oldBounds = win && !win.isDestroyed() ? win.getBounds() : null
  settings = next
  if (win && !win.isDestroyed()) {
    const base = settings.bounds || oldBounds
    if (modeChanged) applyBounds(geometry.boundsForMode(base, settings.expandedBounds, settings.expanded, displayFor(base).workArea))
    else if (settings.expanded && settings.expandedBounds) applyBounds(geometry.boundsForMode(settings.expandedBounds, settings.expandedBounds, true, displayFor(settings.expandedBounds).workArea))
    else applyBounds(geometry.boundsForMode(base, settings.expandedBounds, settings.expanded, displayFor(base).workArea))
  }
  if (!settings.enabled) hideWindow()
  buildMenus()
  publishState()
  return runtime()
}
function buildMenus() {
  const enabled = settings.enabled
  const show = { label: 'Show DSH Mini', enabled, click: () => safeAction(showWindow) }
  const newChat = { label: 'New Chat', accelerator: 'CommandOrControl+N', enabled, click: () => safeAction(() => sendCommand('new-chat')) }
  const preferences = { label: 'Settings…', accelerator: 'CommandOrControl+,', enabled, click: () => safeAction(() => sendCommand('open-settings')) }
  const resizeMode = { label: settings.expanded ? 'Collapse Window' : 'Expand Window', enabled, click: () => safeAction(async () => { setExpanded(!settings.expanded); buildMenus(); await showWindow() }) }
  const hide = { label: 'Hide DSH Mini', accelerator: 'CommandOrControl+W', click: hideWindow }
  const quit = { label: 'Quit DSH Mini', accelerator: 'CommandOrControl+Q', click: () => void quit() }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'DSH Mini', submenu: [show, resizeMode, preferences, { type: 'separator' }, hide, { type: 'separator' }, quit] },
    { label: 'File', submenu: [newChat, hide] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]))
}
function installIPC() {
  const trusted = event => { if (!isTrustedSender(event, win, trustedOrigin)) throw new Error('Untrusted mini window sender.') }
  ipcMain.handle(channels.hide, event => { trusted(event); hideWindow(); return rendererState() })
  ipcMain.handle(channels.expanded, (event, expanded) => { trusted(event); return setExpanded(expanded) })
  ipcMain.handle(channels.getState, event => { trusted(event); return rendererState() })
  ipcMain.handle(channels.drag, (event, phase) => {
    trusted(event)
    if (phase === 'start') beginDrag()
    else if (phase === 'end') endDrag()
    else throw new Error('Drag phase must be start or end.')
  })
  ipcMain.handle(channels.external, async (event, value) => {
    trusted(event)
    const url = externalURL(value, trustedOrigin)
    if (!url) throw new Error('Only clicked external HTTP(S) links can be opened.')
    try { await shell.openExternal(url) } catch { throw new Error('Could not open the external link.') }
  })
}
function cleanup() {
  cancelShow()
  endDrag()
  clearTimeout(geometryTimer)
  clearInterval(parentTimer)
  try { globalShortcut.unregisterAll() } catch {}
  activeShortcut = null
  for (const channel of [channels.hide, channels.expanded, channels.getState, channels.external, channels.drag]) ipcMain.removeHandler(channel)
}
async function quit(response) {
  if (quitting) return
  quitting = true
  cleanup()
  if (response && !process.stdout.destroyed) {
    await new Promise(resolve => process.stdout.write(`${JSON.stringify(response)}\n`, resolve))
  }
  app.quit()
  // No windows exist at startup, but Electron still owns the event loop until app.quit().
}
async function bootstrap(message) {
  if (message?.type !== 'bootstrap' || !originOf(message.url) || typeof message.userDataDir !== 'string' || !path.isAbsolute(message.userDataDir)) throw new Error('Invalid bootstrap: supply a DSH HTTP(S) URL and an absolute profile directory.')
  const [state, bounds, shortcut] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, '../shared/state.mjs')).href),
    import(pathToFileURL(path.join(__dirname, 'geometry.mjs')).href),
    import(pathToFileURL(path.join(__dirname, 'shortcut.mjs')).href),
  ])
  stateHelpers = state; geometry = bounds; shortcuts = shortcut
  settings = state.normalizeState(message.settings)
  authenticatedURL = message.url
  trustedOrigin = originOf(authenticatedURL)
  fs.mkdirSync(message.userDataDir, { recursive: true, mode: 0o700 })
  app.setPath('userData', message.userDataDir)
  app.setName('DSH Mini')
  if (!app.requestSingleInstanceLock()) throw new Error('A mini companion already owns this DSH profile.')
  app.on('second-instance', () => safeAction(showWindow))
  app.on('window-all-closed', () => {})
  app.on('before-quit', () => { quitting = true; cleanup() })
  await app.whenReady()
  if (quitting) return
  if (process.platform === 'darwin') { app.setActivationPolicy('accessory'); app.dock?.hide() }
  installIPC()
  buildMenus()
  updateShortcut(settings.enabled ? settings.shortcut : null)
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => safeAction(clampWindow))
  initialized = true
  output({ type: 'ready', runtime: runtime() })
  // Warm the hidden renderer now, not on the first shortcut press. A ready
  // companion can display immediately without paying for BrowserWindow + DSH
  // page startup in the global-shortcut handler.
  if (settings.enabled) setImmediate(() => { void ensureWindow().catch(() => report('Could not prepare the DSH mini window. Show it again to retry.')) })
  parentTimer = setInterval(() => {
    try { process.kill(parentPID, 0) } catch (error) { if (error.code === 'ESRCH') void quit() }
  }, 2000)
  parentTimer.unref()
}
async function dispatch(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || !['string', 'number'].includes(typeof message.id)) throw new Error('Commands require an id.')
  const { id, command } = message
  try {
    let result
    switch (command) {
      case 'configure': result = configure(message.settings); break
      case 'show': result = await showWindow(); break
      case 'hide': result = hideWindow(); break
      case 'quit': await quit({ type: 'response', id, ok: true, result: runtime() }); return
      default: throw new Error('Unknown mini window command.')
    }
    output({ type: 'response', id, ok: true, result })
  } catch (error) {
    // Only our own command validation messages are surfaced; Electron failures get a safe generic message.
    const safeError = command === 'configure' || command === 'show' && !settings.enabled || !['configure', 'show', 'hide', 'quit'].includes(command)
      ? error.message : 'The native mini window command failed.'
    output({ type: 'response', id, ok: false, error: safeError })
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
let bootstrapped = false
input.on('line', line => {
  queue = queue.then(async () => {
    if (quitting) return
    if (line.length > 1024 * 1024) throw new Error('Protocol message is too large.')
    let message
    try { message = JSON.parse(line) } catch { throw new Error('Invalid JSON protocol message.') }
    if (!bootstrapped) { bootstrapped = true; await bootstrap(message) }
    // Start commands in input order, but do not block hide/disable/quit behind a slow
    // show/load. Responses are correlated by id and can complete out of order.
    else void dispatch(message).catch(() => report('Invalid native protocol message.'))
  }).catch(async () => {
    if (initialized) report('Invalid native protocol message.')
    else {
      output({ type: 'status', runtime: { status: 'error', visible: false, expanded: Boolean(settings?.expanded), shortcutRegistered: Boolean(activeShortcut), error: 'Could not start the mini companion. Check the Electron installation and profile directory; another companion may already own this profile.' } })
      await quit()
    }
  })
})
input.on('close', () => { void quit() })
process.on('SIGTERM', () => { void quit() })
process.on('SIGINT', () => { void quit() })
process.stdout.on('error', () => { void quit() })
process.on('uncaughtException', () => { report('The native mini companion encountered an unexpected error.'); void quit() })
process.on('unhandledRejection', () => { report('The native mini companion encountered an unexpected error.'); void quit() })
