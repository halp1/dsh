'use strict'

// Sandboxed preload: Electron is the only required module; no filesystem or raw IPC is exposed.
const { contextBridge, ipcRenderer } = require('electron')
const channels = {
  hide: 'dsh-mini:hide', expanded: 'dsh-mini:set-expanded', getState: 'dsh-mini:get-state',
  state: 'dsh-mini:state', command: 'dsh-mini:command', external: 'dsh-mini:open-external', drag: 'dsh-mini:drag',
}
const stateListeners = new Set()
const commandListeners = new Set()
const queuedCommands = []
let state = null

function copyState(value) {
  return { expanded: Boolean(value.expanded), visible: Boolean(value.visible) }
}
function notify(listeners, value) {
  for (const listener of [...listeners]) { try { listener(value) } catch {} }
}
ipcRenderer.on(channels.state, (_event, value) => {
  if (!value || typeof value.expanded !== 'boolean' || typeof value.visible !== 'boolean') return
  state = copyState(value)
  notify(stateListeners, copyState(state))
})
ipcRenderer.on(channels.command, (_event, value) => {
  if (!['new-chat', 'open-settings'].includes(value)) return
  if (!commandListeners.size) { queuedCommands.push(value); if (queuedCommands.length > 10) queuedCommands.shift() }
  else notify(commandListeners, value)
})
function subscribe(listeners, listener) {
  if (typeof listener !== 'function') throw new TypeError('A listener function is required.')
  listeners.add(listener)
  return () => listeners.delete(listener)
}
contextBridge.exposeInMainWorld('dshMiniWindow', Object.freeze({
  version: 1,
  hide: () => ipcRenderer.invoke(channels.hide),
  setExpanded: expanded => {
    if (typeof expanded !== 'boolean') return Promise.reject(new TypeError('Expanded must be a boolean.'))
    return ipcRenderer.invoke(channels.expanded, expanded)
  },
  getState: () => ipcRenderer.invoke(channels.getState).then(copyState),
  drag: phase => {
    if (phase !== 'start' && phase !== 'end') return Promise.reject(new TypeError('Drag phase must be start or end.'))
    return ipcRenderer.invoke(channels.drag, phase)
  },
  onState: listener => {
    const unsubscribe = subscribe(stateListeners, listener)
    if (state) { try { listener(copyState(state)) } catch {} }
    return unsubscribe
  },
  onCommand: listener => {
    const unsubscribe = subscribe(commandListeners, listener)
    for (const command of queuedCommands.splice(0)) { try { listener(command) } catch {} }
    return unsubscribe
  },
}))

// Only a genuine user click can open an external HTTP(S) link. Programmatic navigation and
// window.open are denied in main. This internal IPC is deliberately absent from the bridge.
function handleLink(event) {
  if (!event.isTrusted || event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1) || (event.type === 'click' && event.button !== 0)) return
  const anchor = event.composedPath().find(node => node?.tagName === 'A' && typeof node.href === 'string')
  if (!anchor || anchor.hasAttribute('download')) return
  let url
  try { url = new URL(anchor.href) } catch { return }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin === window.location.origin) return
  event.preventDefault()
  ipcRenderer.invoke(channels.external, url.href).catch(() => {})
}
window.addEventListener('click', handleLink, true)
window.addEventListener('auxclick', handleLink, true)
