'use strict'
const { isTrustedURL } = require('./security.cjs')

/** Voice is opt-in per native process. Never grant camera, subframe, or unrelated permissions. */
function installMicrophonePolicy(window, origin, { dialog, systemPreferences, platform = process.platform, isEnabled = () => true, report = () => {} }) {
  let audioAllowed = false, pending = null
  const trusted = (contents, details) => Boolean(!window.isDestroyed() && window.isVisible() && isEnabled() && contents === window.webContents && details?.isMainFrame === true && isTrustedURL(details.requestingUrl, origin) && isTrustedURL(contents.getURL(), origin))
  const session = window.webContents.session
  // Copy buttons use navigator.clipboard.writeText, which Electron gates as
  // `clipboard-sanitized-write`. Writing only; clipboard reads stay denied.
  const clipboardWrite = (contents, permission, requestingOrigin) => permission === 'clipboard-sanitized-write' && !window.isDestroyed() && contents === window.webContents && isTrustedURL(requestingOrigin, origin) && isTrustedURL(contents.getURL(), origin)
  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => clipboardWrite(contents, permission, requestingOrigin) || (audioAllowed && permission === 'media' && details?.mediaType === 'audio' && isTrustedURL(requestingOrigin, origin) && trusted(contents, details)))
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (clipboardWrite(contents, permission, details?.requestingUrl)) { callback(true); return }
    if (permission !== 'media' || !trusted(contents, details) || !Array.isArray(details.mediaTypes) || details.mediaTypes.length !== 1 || details.mediaTypes[0] !== 'audio') { callback(false); return }
    if (audioAllowed) { callback(true); return }
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        const answer = await dialog.showMessageBox(window, {
          type: 'question', message: 'Allow microphone access for DSH Mini?',
          detail: 'DSH can use your microphone for voice input. Camera access is not allowed. This choice lasts until the companion quits.',
          buttons: ['Allow Microphone', 'Not Now'], defaultId: 1, cancelId: 1, noLink: true,
        })
        if (answer.response !== 0 || !trusted(contents, details)) return false
        if (platform === 'darwin' && !await systemPreferences.askForMediaAccess('microphone')) {
          report('Microphone access is blocked by macOS. You can allow it in System Settings → Privacy & Security → Microphone.')
          return false
        }
        audioAllowed = trusted(contents, details)
        return audioAllowed
      }).catch(() => { report('Could not request microphone access. Voice input remains disabled.'); return false }).finally(() => { pending = null })
    }
    pending.then(allowed => callback(Boolean(allowed && trusted(contents, details))))
  })
}
module.exports = { installMicrophonePolicy }
