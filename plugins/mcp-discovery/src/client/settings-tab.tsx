import React, { useEffect, useState } from 'react';

type Mode = 'visible' | 'on-demand' | 'blocked';
type Rule = { prefix: string; mode: Mode };
type ToolRule = { name: string; mode: Mode };
interface Settings { servers: string[]; maxSelectedTools: number; prefixes: Rule[]; tools: ToolRule[] }
interface Snapshot { settings: Settings; revision: number; tools: { name: string; description: string }[] }
const API = 'api/dsh-mcp-discovery.settings';
const protectedNames = ['search_mcp_tools', 'select_mcp_tools'];
const modes: Mode[] = ['visible', 'on-demand', 'blocked'];
const labels: Record<Mode, string> = { visible: 'Visible', 'on-demand': 'On-demand', blocked: 'Blocked' };
const css = `
.discovery-settings { padding:24px; max-width:760px; color:var(--dsw-alias-label-primary); font-size:14px; line-height:1.5; }
.discovery-settings h2 { margin:0 0 8px; font-size:18px; font-weight:600; }
.discovery-settings h3 { margin:0; font-size:15px; font-weight:600; }
.discovery-settings p { margin:0 0 16px; color:var(--dsw-alias-label-secondary); }
.discovery-settings .policy { margin:28px 0; }
.discovery-settings .section-heading { display:flex; gap:12px; align-items:center; justify-content:space-between; margin-bottom:12px; }
.discovery-settings .rule-list { display:grid; gap:8px; padding:0; margin:0; list-style:none; }
.discovery-settings .rule { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--dsw-alias-border-l4); }
.discovery-settings .rule-name { flex:1; min-width:0; overflow-wrap:anywhere; }
.discovery-settings code { font-family:ui-monospace,monospace; font-size:13px; }
.discovery-settings label { display:grid; gap:6px; }
.discovery-settings button, .discovery-settings input, .discovery-settings select { box-sizing:border-box; font:inherit; color:inherit; border:1px solid var(--dsw-alias-border-l4); border-radius:7px; background:var(--dsw-alias-bg-layer-1); min-height:36px; }
.discovery-settings button { padding:7px 12px; cursor:pointer; font-size:13px; }
.discovery-settings input, .discovery-settings select { padding:7px 10px; min-width:0; caret-color:var(--dsw-static-deepseek-450); }
.discovery-settings input { width:100%; }
.discovery-settings .rule input { flex:1; }
.discovery-settings input[type=number] { width:100px; font-variant-numeric:tabular-nums; }
.discovery-settings select { width:136px; flex-shrink:0; }
.discovery-settings input::placeholder { color:var(--dsw-alias-label-secondary); }
.discovery-settings button:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-2); }
.discovery-settings button:active:not(:disabled) { background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2)); }
.discovery-settings button.primary { background:var(--dsw-static-deepseek-450); border-color:transparent; color:var(--dsw-static-white,#fff); }
.discovery-settings button:disabled, .discovery-settings input:disabled, .discovery-settings select:disabled { opacity:.5; cursor:default; }
.discovery-settings :focus-visible { outline:2px solid var(--dsw-static-deepseek-450); outline-offset:3px; }
.discovery-settings ::selection { background:var(--dsw-static-deepseek-450); color:var(--dsw-static-white,#fff); }
.discovery-settings .actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:24px; }
.discovery-settings .empty { padding:12px 0; }
.discovery-settings [role=alert] { color:var(--dsw-alias-state-error-primary,#bc3434); }
.discovery-settings [role=status] { color:var(--dsw-alias-label-secondary); }
.discovery-settings .tool-picker { display:flex; gap:8px; margin:12px 0; }
.discovery-settings .hint { font-size:13px; margin:8px 0 0; }
.discovery-settings fieldset { border:0; margin:0; padding:0; min-width:0; }
@media(max-width:560px) { .discovery-settings { padding:16px; } .discovery-settings .rule { flex-wrap:wrap; } .discovery-settings .rule-name, .discovery-settings .rule input { flex-basis:100%; } .discovery-settings .rule select { flex:1; } .discovery-settings input, .discovery-settings select { font-size:16px; } }
`;

function ModeSelect({ value, label, onChange }: { value: Mode; label: string; onChange: (mode: Mode) => void }) {
  return <select aria-label={label} value={value} onChange={event => onChange(event.target.value as Mode)}>
    {modes.map(mode => <option key={mode} value={mode}>{labels[mode]}</option>)}
  </select>;
}
async function readResponse(response: Response): Promise<Snapshot> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  if (!body.settings || !Array.isArray(body.settings.prefixes) || !Array.isArray(body.tools)) throw new Error('Invalid settings response. Reload and try again.');
  return body;
}
function effectiveMode(settings: Settings, name: string): Mode {
  if (protectedNames.includes(name)) return 'visible';
  const exact = settings.tools.find(rule => rule.name === name);
  if (exact) return exact.mode;
  const prefix = settings.prefixes.filter(rule => name.startsWith(rule.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (prefix) return prefix.mode;
  return settings.servers.some(server => name.startsWith(`mcp__${server}__`)) ? 'on-demand' : 'visible';
}

export function DiscoverySettingsTab(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toolName, setToolName] = useState('');
  const [serverName, setServerName] = useState('');
  const dirty = Boolean(snapshot && draft && JSON.stringify(draft) !== JSON.stringify(snapshot.settings));
  const adopt = (value: Snapshot) => { setSnapshot(value); setDraft(structuredClone(value.settings)); setNotice(''); };
  async function load() {
    setBusy(true);
    setError('');
    try { adopt(await readResponse(await fetch(API, { cache: 'no-store' }))); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load settings. Try again.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function update(patch: Partial<Settings>) {
    setDraft(current => current ? { ...current, ...patch } : current);
    setNotice('');
    setError('');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot || !draft || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      adopt(await readResponse(await fetch(API, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: draft, revision: snapshot.revision }),
      })));
      setNotice('Settings saved. Applies on the next model request.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save settings. Try again.'); }
    finally { setBusy(false); }
  }
  const namespaces = [...new Set([
    ...(draft?.servers || []),
    ...(draft?.prefixes.map(rule => /^mcp__([^_]+(?:_[^_]+)*)__$/u.exec(rule.prefix)?.[1]).filter(Boolean) as string[] || []),
    ...(snapshot?.tools.map(tool => /^mcp__(.+?)__/u.exec(tool.name)?.[1]).filter(Boolean) as string[] || []),
  ])].sort();
  function serverMode(server: string): Mode {
    // A non-tool suffix previews the namespace default without exact overrides.
    return effectiveMode(draft!, `mcp__${server}__.`);
  }
  function changeServer(server: string, mode: Mode) {
    const prefix = `mcp__${server}__`;
    update({
      servers: [...draft!.servers.filter(item => item !== server), ...(mode === 'on-demand' ? [server] : [])].sort(),
      prefixes: [...draft!.prefixes.filter(rule => rule.prefix !== prefix), { prefix, mode }],
    });
  }
  const canAddTool = /^[A-Za-z0-9_-]{1,64}$/u.test(toolName) && !protectedNames.includes(toolName) && !draft?.tools.some(rule => rule.name === toolName);
  const invalidPrefix = draft?.prefixes.some(rule => !/^[A-Za-z0-9_-]{1,64}$/u.test(rule.prefix) || protectedNames.some(name => name.startsWith(rule.prefix)));
  return <section className="discovery-settings" aria-label="Tool Discovery settings">
    <style>{css}</style>
    <h2>Tool Discovery</h2>
    <p>Visible tools are always offered. On-demand tools need selection first. Blocked tools cannot be called.</p>
    {!snapshot && !error && <div role="status">Loading settings...</div>}
    {error && <div role="alert">{error}</div>}
    {error && <button type="button" disabled={busy} onClick={() => void load()}>{snapshot ? 'Reload saved settings' : 'Retry'}</button>}
    {snapshot && draft && <form onSubmit={save}>
      <fieldset disabled={busy}>
        <div className="policy">
          <label htmlFor="discovery-limit">Maximum selected tools per chat</label>
          <input id="discovery-limit" type="number" min="1" max="128" required value={draft.maxSelectedTools} onChange={event => update({ maxSelectedTools: Number(event.target.value) })} />
        </div>
        <section className="policy" aria-labelledby="discovery-servers">
          <div className="section-heading"><h3 id="discovery-servers">MCP servers</h3></div>
          <ul className="rule-list">{namespaces.map(server => <li className="rule" key={server}>
            <span className="rule-name">{server}</span>
            <ModeSelect label={`Mode for ${server}`} value={serverMode(server)} onChange={mode => changeServer(server, mode)} />
          </li>)}</ul>
          <div className="tool-picker">
            <input aria-label="MCP namespace" placeholder="MCP namespace" value={serverName} maxLength={32} onChange={event => setServerName(event.target.value)} />
            <button type="button" disabled={!/^[A-Za-z0-9_-]{1,32}$/u.test(serverName) || serverName.includes('__') || namespaces.includes(serverName)} onClick={() => { changeServer(serverName, 'on-demand'); setServerName(''); }}>Add server</button>
          </div>
        </section>
        <section className="policy" aria-labelledby="discovery-prefixes">
          <div className="section-heading"><h3 id="discovery-prefixes">Prefix rules</h3><button type="button" onClick={() => update({ prefixes: [...draft.prefixes, { prefix: '', mode: 'on-demand' }] })}>Add prefix</button></div>
          <ul className="rule-list">{draft.prefixes.map((rule, index) => <li className="rule" key={index}>
            <input aria-label={`Prefix ${index + 1}`} value={rule.prefix} maxLength={64} required placeholder="Tool name prefix" onChange={event => update({ prefixes: draft.prefixes.map((item, i) => i === index ? { ...item, prefix: event.target.value } : item) })} />
            <ModeSelect label={`Mode for prefix ${index + 1}`} value={rule.mode} onChange={mode => update({ prefixes: draft.prefixes.map((item, i) => i === index ? { ...item, mode } : item) })} />
            <button type="button" aria-label={`Remove prefix ${rule.prefix || index + 1}`} onClick={() => update({ prefixes: draft.prefixes.filter((_, i) => i !== index) })}>Remove</button>
          </li>)}</ul>
          {!draft.prefixes.length && <p className="empty">No prefix rules. Tools use their server default.</p>}
          <p className="hint">The longest matching prefix wins over the server default.</p>
          {invalidPrefix && <p role="alert">Use a tool prefix that does not match search_mcp_tools or select_mcp_tools.</p>}
        </section>
        <section className="policy" aria-labelledby="discovery-tools">
          <div className="section-heading"><h3 id="discovery-tools">Exact tool overrides</h3></div>
          <ul className="rule-list">{draft.tools.map((rule, index) => <li className="rule" key={rule.name}>
            <code className="rule-name">{rule.name}</code>
            <ModeSelect label={`Mode for ${rule.name}`} value={rule.mode} onChange={mode => update({ tools: draft.tools.map((item, i) => i === index ? { ...item, mode } : item) })} />
            <button type="button" aria-label={`Remove override for ${rule.name}`} onClick={() => update({ tools: draft.tools.filter((_, i) => i !== index) })}>Remove</button>
          </li>)}</ul>
          {!draft.tools.length && <p className="empty">No overrides. Tools follow prefix and server rules.</p>}
          <div className="tool-picker">
            <input list="discovery-tool-names" aria-label="Exact tool name" placeholder="Exact tool name" value={toolName} maxLength={64} onChange={event => setToolName(event.target.value)} />
            <datalist id="discovery-tool-names">{snapshot.tools.filter(tool => !protectedNames.includes(tool.name) && !draft.tools.some(rule => rule.name === tool.name)).map(tool => <option key={tool.name} value={tool.name}>{labels[effectiveMode(draft, tool.name)]}</option>)}</datalist>
            <button type="button" disabled={!canAddTool} onClick={() => { update({ tools: [...draft.tools, { name: toolName, mode: effectiveMode(draft, toolName) }] }); setToolName(''); }}>Add override</button>
          </div>
          <p className="hint">Exact overrides win over prefix rules. Discovery controls stay visible.</p>
        </section>
        <div className="actions">
          <button className="primary" type="submit" disabled={!dirty || Boolean(invalidPrefix)}>{busy ? 'Saving...' : 'Save settings'}</button>
          <button type="button" disabled={!dirty} onClick={() => { adopt(snapshot); setError(''); }}>Discard changes</button>
          {notice && <span role="status">{notice}</span>}
        </div>
      </fieldset>
    </form>}
  </section>;
}
