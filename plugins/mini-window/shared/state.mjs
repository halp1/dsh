export const DEFAULT_SHORTCUT = 'Command+Shift+Space'
export const COMPACT_SIZE = { width: 640, height: 112 }
export const EXPANDED_SIZE = { width: 640, height: 600 }
export const MIN_EXPANDED_SIZE = { width: 440, height: 360 }
/** @typedef {{provider: string, model: string, reasoningEffort?: string}} ModelSelection */
/** A null workspaceId means uncategorized. A null WorkspaceDefault keeps the current chat's workspace. */
/** @typedef {{workspaceId: string | null}} WorkspaceDefault */
export const defaultState = () => ({ schemaVersion: 1, revision: 0, enabled: true, shortcut: DEFAULT_SHORTCUT, bounds: null, expandedBounds: null, expanded: false, lastSessionId: null, lastWorkspaceId: null, defaultModel: /** @type {ModelSelection | null} */ (null), defaultWorkspace: /** @type {WorkspaceDefault | null} */ (null) })
/** @returns {WorkspaceDefault | null} */
export function validateDefaultWorkspace(value) {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('workspaceId' in value)) throw new Error('Expected a default workspace or null.')
  const id = value.workspaceId
  if (id !== null && (typeof id !== 'string' || !id || id.length > 256)) throw new Error('Choose an available workspace.')
  return { workspaceId: id }
}
/** @returns {ModelSelection | null} */
export function validateDefaultModel(value) {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['provider','model','reasoningEffort'].includes(key))) throw new Error('Expected a mini model selection or null.')
  for (const key of ['provider','model']) if (typeof value[key] !== 'string' || !value[key] || value[key].length > 256) throw new Error('Choose an available provider and model.')
  if (value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || !value.reasoningEffort || value.reasoningEffort.length > 256)) throw new Error('Choose an available reasoning setting.')
  return { provider: value.provider, model: value.model, ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }) }
}
export function normalizeBounds(value) {
  if (!value || typeof value !== 'object') return null
  if (!['x','y','width','height'].every(k => Number.isFinite(value[k]))) return null
  if (value.width < 100 || value.height < 50 || value.width > 10000 || value.height > 10000) return null
  return Object.fromEntries(['x','y','width','height'].map(k => [k, Math.round(value[k])]))
}
export function validateShortcut(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Enter a shortcut such as Command+Shift+Space.')
  const parts = value.split('+')
  const modifiers = new Set(['Command','Cmd','CommandOrControl','Control','Ctrl','Alt','Option','Shift','Super','Meta'])
  if (parts.length < 2 || !parts.slice(0,-1).every(p => modifiers.has(p)) || new Set(parts.slice(0,-1)).size !== parts.length - 1) throw new Error('Use a modifier and a key, such as Command+Shift+Space.')
  if (!/^(?:[A-Za-z0-9]|Space|Tab|Enter|Escape|Backspace|Delete|Up|Down|Left|Right|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(parts.at(-1))) throw new Error('That shortcut key is not supported.')
  if (['Command+N','Cmd+N','Command+W','Cmd+W','Command+Q','Cmd+Q'].includes(value)) throw new Error('Keep standard app shortcuts local. Choose another global shortcut.')
  return value
}
export function normalizeState(value) {
  const result = defaultState()
  if (!value || typeof value !== 'object') return result
  if (Number.isSafeInteger(value.revision) && value.revision >= 0) result.revision = value.revision
  for (const key of ['enabled','expanded']) if (typeof value[key] === 'boolean') result[key] = value[key]
  try { if (value.shortcut !== undefined) result.shortcut = validateShortcut(value.shortcut) } catch {}
  for (const key of ['bounds','expandedBounds']) result[key] = normalizeBounds(value[key])
  for (const key of ['lastSessionId','lastWorkspaceId']) if (typeof value[key] === 'string' && value[key].length <= 256 && value[key]) result[key] = value[key]
  try { if (value.defaultModel !== undefined) result.defaultModel = validateDefaultModel(value.defaultModel) } catch {}
  try { if (value.defaultWorkspace !== undefined) result.defaultWorkspace = validateDefaultWorkspace(value.defaultWorkspace) } catch {}
  return result
}
export function validatePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a settings patch.')
  const allowed = new Set(['enabled','shortcut','lastSessionId','lastWorkspaceId','defaultModel','defaultWorkspace'])
  const patch = {}
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown setting: ${key}`)
    if (key === 'enabled') { if (typeof item !== 'boolean') throw new Error('Enabled must be a boolean.'); patch[key] = item }
    else if (key === 'shortcut') patch[key] = validateShortcut(item)
    else if (key === 'defaultModel') patch[key] = validateDefaultModel(item)
    else if (key === 'defaultWorkspace') patch[key] = validateDefaultWorkspace(item)
    else { if (item !== null && (typeof item !== 'string' || !item || item.length > 256)) throw new Error('Invalid session or workspace identity.'); patch[key] = item }
  }
  return patch
}
