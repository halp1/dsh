'use strict'

function originOf(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null
  } catch { return null }
}

function isTrustedURL(value, origin) {
  return Boolean(origin && originOf(value) === origin)
}

function isTrustedSender(event, window, origin) {
  try {
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame && isTrustedURL(event.senderFrame.url, origin))
  } catch { return false }
}

function externalURL(value, origin) {
  if (typeof value !== 'string' || value.length > 8192 || !originOf(value) || isTrustedURL(value, origin)) return null
  return new URL(value).href
}

function localCommand(input, platform = process.platform) {
  if (input.type !== 'keyDown' || input.alt || input.shift) return null
  if (platform === 'darwin' ? !input.meta || input.control : !input.control || input.meta) return null
  const key = String(input.key).toLowerCase()
  return key === 'n' ? 'new-chat' : key === 'w' ? 'hide' : null
}

module.exports = { originOf, isTrustedURL, isTrustedSender, externalURL, localCommand }
