import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { RequestError } from './controller.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0

// Host SessionController methods return raw values; Remote faces wrap the same
// values in RemoteResult. Accept either public face, never a private controller.
function unwrap(result) {
  if (object(result) && typeof result.ok === 'boolean') {
    if (!result.ok) throw new RequestError(503, typeof result.error?.message === 'string' ? result.error.message : 'The model service is unavailable.')
    return result.value
  }
  return result
}
function selectionCopy(value) {
  if (!object(value) || Object.keys(value).some(key => !['provider', 'model', 'reasoningEffort'].includes(key)) || !text(value.provider) || !text(value.model) || value.reasoningEffort !== undefined && !text(value.reasoningEffort)) throw new RequestError(400, 'The mini-window default model is invalid.')
  return { provider: value.provider, model: value.model, ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }) }
}
function validCatalog(value) {
  return object(value) && object(value.default) && typeof value.default.provider === 'string' && typeof value.default.model === 'string'
    && Array.isArray(value.routableProviders) && value.routableProviders.every(id => typeof id === 'string')
    && Array.isArray(value.failures) && value.failures.every(failure => object(failure) && text(failure.id) && typeof failure.name === 'string' && typeof failure.message === 'string')
    && Array.isArray(value.groups) && value.groups.every(group => object(group) && text(group.id) && typeof group.name === 'string' && Array.isArray(group.models) && group.models.every(model => object(model) && text(model.id) && typeof model.name === 'string' && (model.reasoning === undefined || object(model.reasoning) && Array.isArray(model.reasoning.efforts) && model.reasoning.efforts.every(effort => object(effort) && text(effort.id) && typeof effort.name === 'string') && (model.reasoning.defaultEffort === undefined || text(model.reasoning.defaultEffort) && model.reasoning.efforts.some(effort => effort.id === model.reasoning.defaultEffort)))))
}

/** Mini-only defaults seed a new durable log BEFORE the ordinary core Agent exists. */
export class MiniModels {
  constructor(ctx, controller) { this.ctx = ctx; this.controller = controller }
  service(name) {
    const service = this.ctx.get(name)
    if (!service) throw new RequestError(503, `The ${name} service is unavailable.`)
    return service
  }
  async catalog() {
    const catalog = unwrap(await this.service('sessionController').modelCatalog())
    if (!validCatalog(catalog)) throw new RequestError(503, 'The model service returned an invalid catalog.')
    return catalog
  }
  async coreCreate(request) {
    const created = unwrap(await this.service('sessionController').create(request))
    if (!object(created) || !text(created.sessionId)) throw new RequestError(503, 'The session service returned an invalid session.')
    return { sessionId: created.sessionId }
  }
  async create(body) {
    if (!object(body) || Object.keys(body).length !== 1 || !(body.workspaceId === null || text(body.workspaceId))) throw new RequestError(400, 'Expected { workspaceId: string | null }.')
    const workspaceId = body.workspaceId
    const request = workspaceId === null ? {} : { workspaceId }
    const saved = (await this.controller.get()).state.defaultModel
    if (saved == null) return this.coreCreate(request)
    // Capture detached values before catalog discovery or any other asynchronous
    // work, so changing the settings cannot change this in-flight creation.
    const selection = selectionCopy(saved)
    const catalog = await this.catalog()
    const matches = catalog.groups.flatMap(group => group.id === selection.provider ? group.models.filter(model => model.id === selection.model) : [])
    if (matches.length !== 1 || !catalog.routableProviders.includes(selection.provider)) throw new RequestError(422, 'The mini-window default model is no longer available. Choose an available model in Settings.')
    if (selection.reasoningEffort !== undefined && !matches[0].reasoning?.efforts.some(effort => effort.id === selection.reasoningEffort)) throw new RequestError(422, 'The selected reasoning setting is no longer available for this model.')
    const workspace = workspaceId === null ? null : this.service('workspaceRegistry').get(workspaceId)
    if (workspaceId !== null && !workspace) throw new RequestError(404, 'The workspace is no longer available.')
    if (workspace && (!text(workspace.path) || !isAbsolute(workspace.path))) throw new RequestError(503, 'The workspace service returned an invalid directory.')
    const sessions = this.service('sessions')
    const persistence = this.service('sessionPersistence')
    const presets = this.ctx.get('agentPresets')
    const preset = presets ? (await presets.resolve()).id : undefined
    if (presets && !text(preset)) throw new RequestError(503, 'The agent preset service returned an invalid preset.')
    const sessionId = `session-${randomUUID()}`
    const event = { type: 'model/selection', data: selection, seq: 0, time: Date.now() }
    // Store-prepared sessions cannot append until publication. Validate the
    // initial event through the public seed boundary without publishing it.
    const prepared = sessions.prepare(sessionId, { seed: [event], meta: { cwd: workspace?.path ?? process.cwd(), ...(preset === undefined ? {} : { agentPreset: preset }) } })
    const handle = await persistence.create(prepared.header)
    try { await handle.append([event]); await handle.flush() }
    finally { await handle.close() }
    // The write lease MUST be released before core resumes this stored prefix.
    // Never enter/announce the detached builder, instantiate an Agent ourselves,
    // or call selectModel (which also changes DSH's global default). On failure
    // retain the new blank record; public persistence exposes no delete API.
    return this.coreCreate({ sessionId, ...request })
  }
}
