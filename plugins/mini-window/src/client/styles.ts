const styles = `
/* Scoped to this plugin: ordinary DSH pages keep their existing appearance. */
html[data-dsh-mini],html[data-dsh-mini] body,html[data-dsh-mini] #root { background:transparent!important; height:100%; margin:0; overflow:hidden; }
/* Keep the document canvas neutral: dark UA canvas colors must not fill the
   transparent native window. Dark control styling belongs to the rounded surface. */
html[data-dsh-mini] { color-scheme:normal!important; --dsw-alias-bg-base:#101112; --dsw-alias-bg-l1:#181a1d; --dsw-alias-bg-l2:#202226; --dsw-alias-label-primary:#ededee; --dsw-alias-label-secondary:#c4c6ca; --dsw-alias-label-tertiary:#b0b3bb; --dsw-alias-label-caption:#a1a5ae; --dsw-alias-border-l1:#25272c; --dsw-alias-border-l2:#383b43; --dsw-alias-border-l3:#30333a; --dsw-alias-border-l4:#565b65; --dsw-specific-input-major:#08090b; --dsw-alias-interactive-bg-hover:#25282d; --dsw-alias-interactive-bg-active:#313640; }
html[data-dsh-mini-preview] #root { width:min(640px,calc(100vw - 64px)); height:600px; margin:32px auto; }
html[data-dsh-mini-preview] #root:has([data-expanded="false"]) { height:112px; }
/* dsh-plugin-background paints a fixed full-viewport stage and makes theme
   surfaces transparent. The mini window paints its own colors, so while that
   plugin is active (html[data-dsh-bg]) the stage is clipped to the rounded
   shell and the shell's opaque fills step aside for the plugin's tint. */
html[data-dsh-mini][data-dsh-bg] #dsh-background-stage { border-radius:28px; }
html[data-dsh-mini][data-dsh-bg]:has(.dshmini-root[data-expanded="false"]) #dsh-background-stage { border-radius:24px; }
html[data-dsh-mini-preview][data-dsh-bg] #dsh-background-stage { inset:32px auto auto 50%!important; width:min(640px,calc(100vw - 64px)); height:600px; transform:translateX(-50%); }
html[data-dsh-mini-preview][data-dsh-bg]:has(.dshmini-root[data-expanded="false"]) #dsh-background-stage { height:112px; }
html[data-dsh-bg] .dshmini-root { --mini-input:color-mix(in srgb,#08090b 62%,transparent); background:transparent; }
html[data-dsh-bg] .dshmini-root [data-composer-seat] { background:transparent; }
/* Expanded: the conversation scrolls under the composer, so its card must hide
   that text. Compact has only the wallpaper behind it and stays translucent. */
html[data-dsh-bg] .dshmini-root[data-expanded="true"] [data-composer-card] { background:color-mix(in srgb,#08090b 96%,transparent); -webkit-backdrop-filter:blur(20px); backdrop-filter:blur(20px); }
html[data-dsh-bg] .dshmini-root[data-expanded="true"] .dshmini-header::before { display:none; }
html[data-dsh-bg] .dshmini-root[data-expanded="true"] [data-conversation-scroll] { -webkit-mask-image:linear-gradient(to bottom,transparent 34px,#000 76px); mask-image:linear-gradient(to bottom,transparent 34px,#000 76px); }
html[data-dsh-bg] .dshmini-panel { background:color-mix(in srgb,#101112 82%,transparent); -webkit-backdrop-filter:blur(18px); backdrop-filter:blur(18px); border-radius:16px; }
.dshmini-root { color-scheme:dark; --mini-bg:#101112; --mini-input:#08090b; --mini-text:#ededee; --mini-muted:#aeb2ba; --mini-border:#565b65; --mini-accent:#547cff; --dsh-composer-side-clearance:0px; --dsh-composer-card-max-width:100%; --dsh-composer-text-max-height:160px; --dsh-content-font-size:14px; --dsh-content-font-delta:0px; box-sizing:border-box; position:relative; height:100%; min-width:0; padding:14px 20px 20px; display:flex; flex-direction:column; background:var(--mini-bg); color:var(--mini-text); border:1px solid var(--mini-border); border-radius:28px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; box-shadow:none; overflow:hidden; }
.dshmini-root *, .dshmini-settings * { box-sizing:border-box; }
.dshmini-root button,.dshmini-root input,.dshmini-root select,.dshmini-settings button,.dshmini-settings input,.dshmini-settings select { font:inherit; }
.dshmini-root ::selection { background:#334ca3; color:#fff; }
.dshmini-root :focus-visible,.dshmini-settings :focus-visible { outline:2px solid #8ba7ff; outline-offset:3px; }
.dshmini-root input,.dshmini-root [data-composer-input] { caret-color:#a9bdff; }
/* The editable caret indicates focus; keep focus rings on actual buttons/forms,
   not a rectangular outline inside the borderless floating pill. */
.dshmini-root [data-composer-input]:focus-visible { outline:none; }
.dshmini-root ::-webkit-scrollbar { width:7px; height:7px; }
.dshmini-root ::-webkit-scrollbar-thumb { border-radius:8px; background:#4a4e58; }
.dshmini-root ::-webkit-scrollbar-thumb:hover { background:#656b77; }
.dshmini-header { height:40px; min-height:40px; display:flex; align-items:center; gap:4px; padding:0 2px 6px; user-select:none; cursor:default; }
.dshmini-icon { border:0; padding:0; flex:none; width:32px; height:32px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:transparent; color:inherit; cursor:pointer; }
.dshmini-icon:hover { background:#282b31; }
.dshmini-icon:disabled { opacity:.4; cursor:default; }
.dshmini-title { flex:0 1 auto; min-width:0; max-width:calc(100% - 176px); display:flex; align-items:baseline; gap:10px; padding:3px 6px; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; border-radius:6px; }
.dshmini-header .dshmini-title + .dshmini-icon { margin-left:auto; }
.dshmini-title:hover { background:#24272d; }
.dshmini-title strong,.dshmini-title span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.dshmini-title strong { font-size:13px; font-weight:600; max-width:65%; }
.dshmini-title span { font-size:11px; color:var(--mini-muted); }
.dshmini-content { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; }
.dshmini-content [data-conversation-content] { flex:1; min-height:0; height:100%; background:transparent; --dsh-composer-side-clearance:0px; --dsh-composer-card-max-width:100%; }
.dshmini-root[data-expanded="true"] [data-composer-seat] { margin-top:auto; bottom:0; }
.dshmini-root [data-conversation-scroll] { min-height:0; background:transparent; padding-inline:0!important; }
/* The shared conversation keeps the composer sticky inside its scrollport. Reserve
   its measured height at the end of the scrollbar track, not over the editor. */
.dshmini-root[data-expanded="true"] [data-conversation-scroll] { --dsh-mini-scroll-inset:var(--dsh-composer-height, 142px); }
.dshmini-root[data-expanded="true"] [data-conversation-scroll]::-webkit-scrollbar-track { margin-bottom:var(--dsh-mini-scroll-inset); }
.dshmini-root [data-composer-seat] { padding:8px 0 0!important; background:var(--mini-bg); }
.dshmini-root [data-composer-card] { background:var(--mini-input); border:0; box-shadow:none; border-radius:28px; padding-top:12px; }
.dshmini-root [data-slot="conversation.composer.bar"] > div { padding-bottom:0; }
.dshmini-root [data-slot="conversation.composer.bar"] > div > div:has(> [data-slot="conversation.composer.dock"]) { display:none; }
/* git-graph's branch chip sits above the composer and pushes the compact card
   out of its fixed 112px window; the mini window has no room for it. */
.dshmini-root [data-gitgraph-chip-anchor],
.dshmini-root [data-slot="conversation.input.dock"]:has(> [data-gitgraph-chip-anchor]:only-child) { display:none!important; }
/* Keep the complete toolbar in a single row even at the minimum expanded width.
   Let long model/access names truncate before actions wrap or the composer grows. */
.dshmini-root [data-composer-card] .uV2eYG_row { flex-wrap:nowrap!important; gap:6px!important; }
.dshmini-root [data-composer-card] .uV2eYG_row > :first-child { gap:4px!important; min-width:0; }
.dshmini-root [data-composer-card] .uV2eYG_row > :last-child { min-width:0!important; flex:0 1 auto!important; gap:4px!important; }
.dshmini-root [data-composer-card] .uV2eYG_row > :last-child > :first-child,
.dshmini-root [data-composer-card] .uV2eYG_row [data-slot="conversation.input.model"] > div { min-width:0!important; max-width:100%; }
.dshmini-root [data-composer-card] .uV2eYG_row [data-slot="conversation.input.model"] button:not(.codexModelSelectMenu *) { min-width:0!important; max-width:100%; }
.dshmini-root [data-composer-card] .uV2eYG_row [data-slot="conversation.input.model"] button:not(.codexModelSelectMenu *) > span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@media (max-width:560px) {
  .dshmini-root[data-expanded="true"] [data-composer-card] .uV2eYG_row [aria-label^="Access mode"] > span:nth-child(2) { display:none; }
  .dshmini-root[data-expanded="true"] [data-composer-card] .uV2eYG_row [data-slot="conversation.input.model"] button:not(.codexModelSelectMenu *) > span:nth-child(2) { display:none; }
  .dshmini-root[data-expanded="true"] [data-composer-card] .uV2eYG_row .uV2eYG_modes { flex:0 0 44px!important; min-width:44px!important; }
  .dshmini-root[data-expanded="true"] [data-composer-card] .uV2eYG_row > :first-child { flex:0 0 auto!important; }
  .dshmini-root[data-expanded="true"] [data-composer-card] .uV2eYG_row > :last-child > :first-child { min-width:0!important; }
  .dshmini-root[data-expanded="true"] [data-composer-card] .uV2eYG_row [data-slot="conversation.input.right"] button:not(.codexModelSelectMenu *),
  .dshmini-root[data-expanded="true"] [data-composer-card] .uV2eYG_row [data-slot="conversation.input.model"] button:not(.codexModelSelectMenu *) { max-width:70px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
}
.dshmini-root[data-expanded="true"] .dshmini-title strong { display:none; }
.dshmini-root[data-expanded="true"] .dshmini-title span { font-size:12px; }
.dshmini-root [data-composer-input] { min-height:24px; font-size:14px; color:#ededee; }
.dshmini-root [data-composer-placeholder] { color:#a8adb7; }
.dshmini-root[data-expanded="false"] { padding:0; border:0; border-radius:24px; background:transparent; --dsh-composer-text-max-height:32px; }
.dshmini-root[data-expanded="false"] .dshmini-header { display:none; }
.dshmini-root[data-expanded="false"] [data-conversation-scroll] { overflow:visible; display:flex; flex-direction:column; justify-content:flex-end; margin:0!important; }
.dshmini-root[data-expanded="false"] [data-conversation-scroll] > :not([data-composer-seat]) { display:none; }
.dshmini-root[data-expanded="false"] [data-composer-seat] { position:relative!important; inset:auto!important; padding:0!important; width:100%; height:100%; background:transparent; }
.dshmini-root[data-expanded="false"] [data-slot="conversation.composer.bar"] > div { height:100%; }
.dshmini-root[data-expanded="false"] [data-composer-card] { height:112px; min-height:112px; justify-content:center; gap:6px; padding:16px 12px 12px; border:1px solid var(--mini-border); border-radius:24px; }
.dshmini-root[data-expanded="false"] [data-composer-input] { min-height:32px; padding:4px 12px; line-height:24px; }
.dshmini-root[data-expanded="false"] [data-composer-card] > div:last-child { padding:0 6px; }
/* The shared composer anchors its flyout above the trigger and its submenu to
   the left. The compact native window cannot show an upward menu, and the
   expanded 440px window cannot show a side-by-side 420px submenu. */
.dshmini-root .codexModelSelect { position:static; }
.dshmini-root .codexModelSelectMenu { position:absolute; top:auto; bottom:62px; left:12px; right:12px; width:auto; min-width:0; max-width:none; max-height:min(360px,calc(100vh - 100px)); overflow-y:auto; overflow-x:hidden; z-index:40; }
.dshmini-root .codexModelSelectSubmenu { position:relative; top:auto; bottom:auto; left:auto; right:auto; width:100%; min-width:0; max-width:none; height:auto; max-height:min(220px,calc(100vh - 200px)); margin-top:4px; }
.dshmini-root .codexModelSelectMenu .codexModelSelectOption,.dshmini-root .codexModelSelectMenu .codexModelSelectCell { width:100%; min-width:100%; max-width:none; }
.dshmini-root .codexModelSelectGroups { max-height:min(212px,calc(100vh - 208px)); }
.dshmini-root[data-expanded="false"] .codexModelSelectMenu { bottom:8px; max-height:calc(100vh - 16px); }
.dshmini-root[data-expanded="false"] .codexModelSelectSubmenu { max-height:calc(100vh - 125px); }
.dshmini-root[data-expanded="false"] .codexModelSelectGroups { max-height:calc(100vh - 133px); }
.dshmini-root[data-expanded="false"] [data-composer-placeholder] { font-size:14px; }
.dshmini-root[data-expanded="false"] .dshmini-notice { position:absolute; z-index:4; top:8px; left:24px; right:24px; }
/* The expanded conversation passes beneath the floating controls. The fade
   softens scrolled text without blocking the drag surface between buttons. */
.dshmini-root[data-expanded="true"] .dshmini-header { position:absolute; z-index:8; top:1px; left:1px; right:1px; height:68px; padding:12px 21px 22px; margin:0; isolation:isolate; }
.dshmini-root[data-expanded="true"] .dshmini-header::before { content:""; position:absolute; z-index:-1; inset:0 0 -30px; background:linear-gradient(to bottom,var(--mini-bg) 0%,var(--mini-bg) 43%,rgba(16,17,18,.88) 67%,transparent 100%); pointer-events:none; }
.dshmini-root[data-expanded="true"] .dshmini-content { height:100%; }
.dshmini-root[data-expanded="true"] [data-conversation-scroll] { padding-top:76px!important; scroll-padding-top:76px; }
.dshmini-drag-strip { display:none; }
.dshmini-root[data-expanded="false"] .dshmini-drag-strip { display:block; position:absolute; z-index:2; top:0; left:56px; right:56px; height:12px; }
.dshmini-notice { display:flex; gap:8px; align-items:flex-start; color:#f6ccd0; background:#3b2328; border-radius:10px; padding:8px 10px; font-size:12px; line-height:1.5; flex:none; max-height:90px; overflow:auto; margin-bottom:6px; }
.dshmini-notice span { flex:1; }
.dshmini-notice button { border:0; padding:0; background:none; color:inherit; cursor:pointer; }
.dshmini-setup { padding:16px; margin:auto; font-size:14px; color:var(--mini-text); width:100%; }
.dshmini-setup p { margin:0 0 12px; }
.dshmini-setup label { display:grid; gap:8px; }
.dshmini-setup select { width:100%; background:#202228; color:#ededee; border:1px solid #4a4f59; border-radius:8px; padding:8px; }
.dshmini-panel { position:absolute; z-index:10; inset:62px 20px 20px; overflow:auto; background:var(--mini-bg); }
.dshmini-picker { height:100%; display:flex; flex-direction:column; min-height:0; padding:12px 4px 0; }
.dshmini-picker-top,.dshmini-settings-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.dshmini-picker h2,.dshmini-settings h2 { margin:0; font-size:19px; font-weight:600; line-height:1.4; }
.dshmini-search { margin:16px 0 12px; display:flex; align-items:center; gap:10px; padding:10px 12px; background:#202228; border:1px solid #424650; border-radius:12px; flex:none; }
.dshmini-search input { width:100%; min-width:0; background:transparent; border:0; outline:none; color:inherit; font-size:14px; }
.dshmini-search:focus-within { border-color:#8ba7ff; }
.dshmini-search input::placeholder { color:#aeb2ba; }
.dshmini-results { flex:1; min-height:0; overflow:auto; padding:0 4px 8px 0; }
.dshmini-session { width:100%; display:flex; flex-direction:column; text-align:left; gap:5px; padding:12px; border:0; border-bottom:1px solid #25282e; border-radius:8px; background:transparent; color:inherit; cursor:pointer; }
.dshmini-session:hover,.dshmini-session:focus-visible { background:#202329; }
.dshmini-session-title { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:500; }
.dshmini-session-meta { font-size:11px; color:#aeb2ba; }
.dshmini-snippet { font-size:12px; line-height:1.5; color:#bec4d0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
.dshmini-settings { max-width:760px; padding:20px 24px; color:var(--dsw-alias-label-primary,inherit); }
.dshmini-panel .dshmini-settings { padding:16px 4px; color:#ededee; min-height:0; overflow-y:auto; }
.dshmini-muted { color:var(--dsw-alias-label-secondary,#aeb2ba); font-size:13px; line-height:1.6; }
.dshmini-root .dshmini-muted { color:#aeb2ba; }
.dshmini-toggle { display:flex; align-items:center; justify-content:space-between; gap:16px; margin:28px 0; }
.dshmini-toggle strong { font-size:14px; font-weight:500; }
.dshmini-toggle small { display:block; color:var(--dsw-alias-label-secondary,#aeb2ba); font-size:12px; line-height:1.6; margin-top:4px; }
.dshmini-toggle input { width:18px; height:18px; accent-color:#547cff; }
.dshmini-field { display:grid; gap:8px; font-size:14px; font-weight:500; }
.dshmini-model-defaults h3 { font-size:16px; font-weight:600; margin:28px 0 12px; }
.dshmini-model-defaults .dshmini-field + .dshmini-field { margin-top:16px; }
.dshmini-field input,.dshmini-field select { width:100%; min-width:0; border:1px solid var(--dsw-alias-border-l3,#464b56); border-radius:9px; padding:10px 12px; background:var(--dsw-alias-bg-l1,#202228); color:inherit; font-weight:400; }
.dshmini-actions { display:flex; gap:8px; flex-wrap:wrap; margin:18px 0 28px; }
.dshmini-button { border:1px solid var(--dsw-alias-border-l3,#424650); background:var(--dsw-alias-bg-l1,#202228); color:inherit; border-radius:9px; padding:8px 12px; font-size:13px; cursor:pointer; }
.dshmini-button:hover { background:var(--dsw-alias-interactive-bg-hover,#30343d); }
.dshmini-button:disabled { opacity:.45; cursor:default; }
.dshmini-primary { background:#365ac5; color:white; border-color:#365ac5; }
.dshmini-primary:hover { background:#436bdc; }
.dshmini-runtime { display:flex; align-items:center; gap:8px; margin-top:24px; font-size:13px; }
.dshmini-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:#9c9fa8; flex:none; }
.dshmini-dot.is-ready { background:#8db6ff; }
.dshmini-error { color:var(--dsw-alias-state-error,#e4848f); line-height:1.6; font-size:13px; overflow-wrap:anywhere; }
.dshmini-root .dshmini-error { color:#f0a6ae; }
.dshmini-help { border-top:1px solid var(--dsw-alias-border-l3,#363941); padding-top:14px; color:var(--dsw-alias-label-secondary,#aeb2ba); font-size:12px; line-height:1.6; }
.dshmini-help kbd { font:inherit; color:inherit; background:var(--dsw-alias-bg-l1,#202228); border:1px solid var(--dsw-alias-border-l3,#464b56); border-radius:4px; padding:2px 5px; }
.dshmini-resize-hint { position:absolute; pointer-events:none; bottom:7px; right:8px; color:#7b818e; }
@media(max-width:500px) { .dshmini-title span { display:none; } .dshmini-root { --dsh-composer-model-text-display:none; --dsh-composer-model-icon-display:inline-flex; padding-inline:14px; } .dshmini-root[data-expanded="false"] { padding:0; } .dshmini-settings { padding:16px; } }
@media(prefers-reduced-motion:no-preference) { .dshmini-icon,.dshmini-button,.dshmini-session { transition:background-color 120ms ease-out; } }
`
export function installStyles(doc: Document) { const element = doc.createElement('style'); element.dataset.plugin = 'dsh-plugin-mini-window'; element.textContent = styles; doc.head.appendChild(element); return () => element.remove() }
