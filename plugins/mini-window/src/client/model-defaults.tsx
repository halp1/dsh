import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { HostClient, MiniState, ModelCatalog } from './host-client.ts'

const key = (selection: NonNullable<MiniState['defaultModel']>) => JSON.stringify([selection.provider, selection.model])
export function ModelDefaults({ client }: { client: HostClient }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const [selection, setSelection] = useState(snapshot.state.defaultModel)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const alive = useRef(true)
  const stored = JSON.stringify(snapshot.state.defaultModel)
  useEffect(() => { setSelection(snapshot.state.defaultModel) }, [stored])
  const load = async () => {
    setLoading(true); setError(null)
    try { const value = await client.models(); if (alive.current) setCatalog(value) }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setLoading(false) }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false } }, [client])
  const choices = catalog?.groups.flatMap(group => group.models.map(model => ({ group, model }))) ?? []
  const picked = choices.find(({ group, model }) => group.id === selection?.provider && model.id === selection?.model)
  const supported = !selection || Boolean(picked) && (selection.reasoningEffort === undefined || Boolean(picked?.model.reasoning?.efforts.some(effort => effort.id === selection.reasoningEffort)))
  const dirty = JSON.stringify(selection) !== stored
  const save = async () => {
    setBusy(true); setError(null); setSaved(false)
    try { await client.patch({ defaultModel: selection }); if (alive.current) setSaved(true) }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="dshmini-model-defaults" aria-labelledby="mini-model-heading" data-main-default={catalog?.default ? JSON.stringify(catalog.default) : undefined}>
    <h3 id="mini-model-heading">New mini chats</h3>
    <p className="dshmini-muted">Choose a default for this window only. Existing chats keep their model; your main DSH default is unchanged.</p>
    <form onSubmit={event => { event.preventDefault(); void save() }}>
      <label className="dshmini-field">Default model<select value={selection ? key(selection) : ''} disabled={busy || loading || snapshot.loading} onChange={event => {
        const choice = choices.find(({ group, model }) => key({ provider: group.id, model: model.id }) === event.target.value)
        setSelection(choice ? { provider: choice.group.id, model: choice.model.id } : null); setSaved(false)
      }}>
        <option value="">Use main DSH default</option>
        {selection && !picked && <option value={key(selection)} disabled>Unavailable saved model: {selection.model}</option>}
        {catalog?.groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={key({ provider: group.id, model: model.id })}>{model.name}</option>)}</optgroup>)}
      </select></label>
      {picked?.model.reasoning && <label className="dshmini-field">Reasoning<select value={selection?.reasoningEffort ?? ''} disabled={busy} onChange={event => {
        if (!selection) return
        setSelection({ provider: selection.provider, model: selection.model, ...(event.target.value ? { reasoningEffort: event.target.value } : {}) }); setSaved(false)
      }}>
        <option value="">Model default</option>
        {selection?.reasoningEffort && !picked.model.reasoning.efforts.some(effort => effort.id === selection.reasoningEffort) && <option value={selection.reasoningEffort} disabled>Unavailable: {selection.reasoningEffort}</option>}
        {picked.model.reasoning.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
      </select></label>}
      {selection && picked && !picked.model.reasoning && <p className="dshmini-muted">This model does not advertise a configurable reasoning setting.</p>}
      <p className="dshmini-muted">After saving, use ⌘N to start a mini chat with these defaults. Only settings supported by the selected model are shown.</p>
      <div className="dshmini-actions"><button className="dshmini-button dshmini-primary" type="submit" disabled={busy || loading || !dirty || !supported}>Save mini defaults</button><button className="dshmini-button" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Loading models…' : 'Refresh models'}</button></div>
    </form>
    {!supported && !loading && <p className="dshmini-error" role="alert">The saved model or reasoning setting is unavailable. Refresh models or choose another option.</p>}
    {catalog?.failures?.length ? <p className="dshmini-muted">Some providers are unavailable. Refresh models to retry.</p> : null}
    {error && <p className="dshmini-error" role="alert">{error}</p>}
    {saved && !error && <p className="dshmini-muted" role="status">Mini defaults saved. Start a new chat to use them.</p>}
  </section>
}
