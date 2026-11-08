import React, { useEffect, useState } from 'react';
import type { ProviderFieldDefinition } from '../types.ts';

const API = 'api/dsh-multi-search.settings';
interface ProviderView {
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, string>;
  hasApiKey?: boolean;
}
interface Snapshot {
  settings: { providers: ProviderView[] };
  adapters: { id: string; fields: ProviderFieldDefinition[] }[];
  revision: number;
}

const css = `
.multi-search-settings { padding:24px; max-width:720px; color:var(--dsw-alias-label-primary); }
.multi-search-settings h2 { margin:0 0 8px; font-size:18px; font-weight:600; }
.multi-search-settings p { margin:0 0 24px; color:var(--dsw-alias-label-secondary); font-size:14px; line-height:1.5; }
.multi-search-settings ol { list-style:none; padding:0; margin:0 0 24px; }
.multi-search-settings li { padding:20px 0; border-bottom:1px solid var(--dsw-alias-border-l4); }
.multi-search-settings li:first-child { padding-top:0; }
.multi-search-settings header { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:16px; }
.multi-search-settings h3 { font-size:15px; font-weight:600; margin:0; }
.multi-search-settings .rank { font-size:13px; color:var(--dsw-alias-label-secondary); }
.multi-search-settings .actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.multi-search-settings header .actions { margin-left:auto; }
.multi-search-settings button { font:inherit; font-size:13px; padding:7px 12px; border:1px solid var(--dsw-alias-border-l4); border-radius:7px; background:var(--dsw-alias-bg-layer-1); color:inherit; cursor:pointer; }
.multi-search-settings button:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2); }
.multi-search-settings button:disabled { opacity:.45; cursor:default; }
.multi-search-settings button.primary { background:var(--dsw-static-deepseek-450,#4167df); color:white; border-color:transparent; }
.multi-search-settings .fields { display:grid; gap:14px; }
.multi-search-settings .field { display:grid; gap:6px; font-size:14px; }
.multi-search-settings input:not([type=checkbox]) { box-sizing:border-box; width:100%; min-width:0; padding:9px 11px; font:inherit; color:inherit; border:1px solid var(--dsw-alias-border-l4); border-radius:7px; background:var(--dsw-alias-bg-layer-1); caret-color:var(--dsw-static-deepseek-450); }
.multi-search-settings input::placeholder { color:var(--dsw-alias-label-secondary); }
.multi-search-settings :focus-visible { outline:2px solid var(--dsw-static-deepseek-450,#4167df); outline-offset:3px; }
.multi-search-settings .enabled { display:flex; gap:6px; align-items:center; font-size:13px; }
.multi-search-settings .secret { display:flex; gap:8px; align-items:center; }
.multi-search-settings [role=alert] { color:var(--dsw-alias-state-error-primary,#ed6969); }
.multi-search-settings [role=status] { font-size:14px; }
@media(max-width:520px) { .multi-search-settings { padding:16px; } .multi-search-settings header .actions { margin-left:0; width:100%; } .multi-search-settings input:not([type=checkbox]) { font-size:16px; } }
`;

async function readResponse(response: Response): Promise<Snapshot> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  if (!Array.isArray(body.settings?.providers)) throw new Error('The server returned invalid settings.');
  return body;
}

export function MultiSearchSettingsTab(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);

  const adopt = (data: Snapshot) => {
    setSnapshot(data);
    setProviders(data.settings.providers);
    setDirty(false);
  };
  async function load() {
    setBusy(true);
    setError('');
    try { adopt(await readResponse(await fetch(API, { cache: 'no-store' }))); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load settings.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    // Remove the obsolete browser-side credential cache. Settings belong to the host.
    try { localStorage.removeItem('dsh.multi-search.settings'); } catch { /* storage unavailable */ }
    void load();
  }, []);

  function update(index: number, patch: Partial<ProviderView>) {
    setProviders(items => items.map((item, i) => i === index ? { ...item, ...patch } : item));
    setDirty(true);
    setNotice('');
  }
  function move(index: number, direction: number) {
    setProviders(items => {
      const next = [...items];
      const target = index + direction;
      if (target < 0 || target >= next.length) return items;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setDirty(true);
    setNotice('');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await readResponse(await fetch(API, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: { providers }, revision: snapshot.revision }),
      }));
      adopt({ ...data, adapters: data.adapters || snapshot.adapters });
      setNotice('Saved. New searches use this order.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  }
  let enabledRank = 0;
  return <section className="multi-search-settings" aria-label="Multi-Search settings">
    <style>{css}</style>
    <h2>Multi-Search</h2>
    <p>Search providers run from top to bottom. On failure, the next enabled provider is tried.</p>
    {!snapshot && !error && <div role="status">Loading settings...</div>}
    {error && <><p role="alert">{error}</p>{snapshot && <button type="button" onClick={() => void load()} disabled={busy}>Reload saved settings</button>}</>}
    {!snapshot && error && <button onClick={() => void load()} disabled={busy}>Retry</button>}
    {snapshot && <form onSubmit={save}>
      <ol aria-label="Search provider order">
        {providers.map((provider, index) => {
          const fields = snapshot.adapters.find(a => a.id === provider.id)?.fields || [];
          const rank = provider.enabled ? enabledRank++ : -1;
          return <li key={provider.id} data-provider={provider.id}>
            <header>
              <h3>{provider.name}</h3>
              <span className="rank">{rank < 0 ? 'Disabled' : rank === 0 ? 'Primary' : `Fallback ${rank}`}</span>
              <div className="actions">
                <button type="button" aria-label={`Move ${provider.name} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}>Move up</button>
                <button type="button" aria-label={`Move ${provider.name} down`} disabled={busy || index === providers.length - 1} onClick={() => move(index, 1)}>Move down</button>
                <label className="enabled"><input type="checkbox" checked={provider.enabled} disabled={busy} onChange={e => update(index, { enabled: e.target.checked })} aria-label={`Enable ${provider.name}`} />Enabled</label>
              </div>
            </header>
            <div className="fields">{fields.map(field => {
              const secret = field.type === 'password';
              const clearing = secret && provider.config[field.key] === '';
              return <div className="field" key={field.key}>
                <label htmlFor={`multi-${provider.id}-${field.key}`}>{field.label}</label>
                <div className={secret ? 'secret' : undefined}>
                  <input id={`multi-${provider.id}-${field.key}`} type={field.type || 'text'} disabled={busy} autoComplete={secret ? 'new-password' : 'off'} value={provider.config[field.key] ?? ''} placeholder={secret ? (clearing ? 'Key will be removed on save' : provider.hasApiKey ? 'Key saved. Enter a replacement' : 'Enter API key') : field.placeholder} onChange={e => {
                    const config = { ...provider.config };
                    if (secret && !e.target.value) delete config[field.key];
                    else config[field.key] = e.target.value;
                    update(index, { config });
                  }} />
                  {secret && provider.hasApiKey && <button type="button" disabled={busy} onClick={() => {
                    const config = { ...provider.config };
                    if (clearing) delete config[field.key];
                    else config[field.key] = '';
                    update(index, { config });
                  }}>{clearing ? 'Keep key' : 'Clear key'}</button>}
                </div>
              </div>;
            })}</div>
          </li>;
        })}
      </ol>
      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !dirty}>{busy ? 'Saving...' : 'Save settings'}</button>
        <button type="button" disabled={busy || !dirty} onClick={() => { adopt(snapshot); setError(''); setNotice(''); }}>Discard changes</button>
        {notice && <span role="status">{notice}</span>}
      </div>
    </form>}
  </section>;
}
