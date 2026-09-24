# dsh-plugin-background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dsh web plugin that shows a user-chosen image (or rotation) behind a semi-transparent app, managed from a Settings → Background tab, state shared per host.

**Architecture:** Node half owns `state.json` and three authenticated `/api/dsh-background.*` Fetch routes (state read, state ops, file stream). Browser half fetches state, computes the image pool/rotation, drives a fixed stage layer behind `#root`, makes the host's background tokens translucent through `ctx.theme.overrideTokens`, and registers a React `settings.section` tab.

**Tech Stack:** TypeScript 6, tsdown (node ESM + closure-factory browser bundle), React (host module table), node:test with native type stripping.

**Spec:** `docs/superpowers/specs/2026-09-23-background-plugin-design.md`

**Execution note:** the user asked for the plugin to be built and installed without a separate plan review, so this plan is deliberately compact (interfaces + test lists rather than full code listings) and is executed inline.

## Global Constraints

- Package name `dsh-plugin-background`; cordis entry id `background`; client id `dsh-plugin-background`.
- Host line 0.1.7-rc.1; devDependency type packages pinned to `0.1.7-rc.1`.
- Browser bundle may `require` only: react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis, @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit.
- Node half has no runtime dependencies (node builtins only).
- Routes: `/api/dsh-background.state` (GET, POST), `/api/dsh-background.file` (GET, HEAD). Client uses relative URLs (`api/...`), same as the host's own RPC caller.
- Image extensions: png, jpg, jpeg, webp, gif, avif, svg.
- Defaults: opacity 0.85 (range 0.30–1.00), blur 0 (0–40 px), fit cover, position center, rotation off / 15 min (1–1440) / shuffle.
- State file `<$DSH_HOME or ~/.dsh>/plugins/background/state.json`, override via config `stateFile`.
- Pure modules must import nothing from the DOM or node so `node --test` runs them directly.

## Deviation from spec (recorded)

The builtin light/dark themes register **empty** token maps; the real values are
stylesheet rules like `--dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950)`.
So instead of parsing colors (`color.ts`), `tokens.ts` builds overrides as
`color-mix(in srgb, <raw value> <pct>%, transparent)`, where the raw value is
read from the document's `body` / `body[data-ds-dark-theme]` rules (falling back
to the known 0.1.7 values), or from a registered custom theme's tokens when it
defines them. No color parsing needed; works for both schemes.

## Review Focus

1. Local path with `~`, trailing slash, or spaces → resolves and serves correctly (sources test).
2. Folder whose files change after adding (file deleted → index shifts) → out-of-range index 404s and the stage skips to the next image instead of showing a broken layer (routes test + controller fallback).
3. Two devices saving at once → the second gets 409, adopts server state, retries once; no lost entry (routes test for 409 + state-client test).
4. Symlink inside a folder pointing outside it → not listed, not served (sources test).
5. Theme switch light↔dark while a background is showing → overrides use the matching palette, not the stale one (tokens test builds both modes at once).

---

### Task 1: Scaffold

**Files:** `package.json`, `cordis.patch.yml`, `tsconfig.base.json`, `tsconfig.json`, `tsconfig.client.json`, `tsdown.config.ts`, `pnpm-workspace.yaml`, `src/index.ts` (stub), `src/client/index.ts` (stub)

- [ ] Copy badge's config shape; add `@deepseek-ai/dsh-client-ui-dockkit` to PLATFORM_MODULES; client entry `src/client/index.ts`; tsconfig.client includes `**/*.tsx` with `"jsx": "react-jsx"`.
- [ ] devDependencies: `@deepseek-ai/cordis ^4.0.2`, `@deepseek-ai/dsh-client-ui-slots`, `-primitives`, `-theme`, `-settings`, `@deepseek-ai/dsh-client-connection` (all `0.1.7-rc.1`), `@types/node`, `@types/react`, `tsdown`, `typescript`.
- [ ] `package.json#dsh.client.inject`: `@deepseek-ai/dsh-client-ui-settings`, `@deepseek-ai/dsh-client-ui-theme`, `@deepseek-ai/dsh-client-ui-slots`.
- [ ] `pnpm install && pnpm build` succeeds with stubs. Commit.

### Task 2: State model (pure) — `src/shared/state.ts`

**Produces:**
```ts
export const IMAGE_EXTENSIONS: ReadonlySet<string>
export type Fit, Position, Appearance, Entry, Rotation, State   // per spec
export const DEFAULT_APPEARANCE: Appearance
export const DEFAULT_ROTATION: Rotation
export function emptyState(): State
export function normalizeState(raw: unknown): State              // drop unknown, clamp, fix enums, null dangling activeId
export function normalizeAppearancePatch(raw: unknown): Partial<Appearance>
export function mergeAppearance(global: Appearance, overrides?: Partial<Appearance>): Appearance
export type Op = {type:'add', source, label?} | {type:'remove', id} | {type:'update-entry', id, patch} | {type:'set-active', id: string|null} | {type:'set-appearance', patch} | {type:'set-rotation', patch}
export function applyOp(state: State, op: Op, added?: Entry): State // pure; 'add' takes the validated entry from the caller
export function newEntryId(): string
```
- [ ] Tests `tests/state.test.js`: defaults; garbage → empty; clamping (opacity 5 → 1, blur -3 → 0, interval 0 → 1); bad enum → default; dangling activeId → null; unknown fields dropped; each op; remove of active clears activeId; overrides null clears; mergeAppearance.
- [ ] Implement, pass, commit.

### Task 3: Sources (node) — `src/node/sources.ts`

**Produces:**
```ts
export class SourceError extends Error {}                         // message is user-facing
export function expandHome(p: string, home?: string): string
export function isUrl(s: string): boolean                        // http:/https: only
export async function resolveSource(input: string): Promise<{kind, source, label}>   // throws SourceError
export async function listFolderImages(dir: string): Promise<string[]>  // absolute realpaths, sorted by basename, inside dir only
export function isImagePath(p: string): boolean
export function contentTypeFor(p: string): string
```
- [ ] Tests (temp dirs): URL classify; `~` expansion; trailing slash; spaces; missing → SourceError "does not exist"; non-image file → SourceError; empty folder → SourceError; folder sorting; subfolders ignored; symlink escaping folder excluded; symlink inside folder included; content types.
- [ ] Implement, pass, commit.

### Task 4: State store + routes (node) — `src/node/store.ts`, `src/node/routes.ts`, `src/index.ts`

**Produces:**
```ts
// store.ts
export class StateStore { constructor(file: string, log?: (msg: string) => void); load(): Promise<State>; save(next: State): Promise<void>; get current(): State }
export function defaultStateFile(env?: NodeJS.ProcessEnv, home?: string): string
// routes.ts
export interface RouteDeps { store: StateStore }
export async function handleGetState(deps): Promise<Response>
export async function handlePostState(req: Request, deps): Promise<Response>
export async function handleFile(req: Request, deps): Promise<Response>
export async function describeSources(state: State): Promise<{folders, files}>
```
- [ ] Store tests: missing file → empty state; round trip; atomic write (no temp left); corrupt JSON → quarantined `state.json.bad-*` + empty; revision increments on save.
- [ ] Route tests: GET shape; POST add file/folder/url; add invalid → 400 message; stale baseRevision → 409 with state; unknown op → 400; file route serves bytes + content-type + ETag; If-None-Match → 304; unknown entry / url entry / out-of-range / non-numeric i → 404; HEAD has no body.
- [ ] `index.ts`: `name = 'background'`, `apply(ctx, config)` → store at `config.stateFile ?? defaultStateFile()`, `ctx.inject(['connection'], ...)` registering three routes via `ctx.effect`.
- [ ] Implement, pass, commit.

### Task 5: Pool + rotation (pure) — `src/client/pool.ts`, `src/client/rotation.ts`

**Produces:**
```ts
export interface PoolItem { key: string; entryId: string; index: number; url: string; appearance: Appearance }
export interface SourceInfo { folders: Record<string, {count:number}|{error:string}>; files: Record<string,{ok:boolean}> }
export function fileUrl(entryId: string, index: number): string   // 'api/dsh-background.file?entry=..&i=..'
export function buildPool(state: State, info: SourceInfo, pickFolderIndex: (entryId: string, count: number) => number): PoolItem[]
export function fnv1a(s: string): number
export function pickIndex(now: number, intervalMin: number, n: number, order: 'sequential'|'shuffle', seedKey: string): number
export function msUntilNext(now: number, intervalMin: number): number
```
- [ ] Tests: rotation off → active entry only; folder active → one item using picker; rotation on → inRotation entries flattened; empty rotation set → falls back to active; broken folder/file skipped; overrides merged; sequential wraps; shuffle is a permutation per cycle, deterministic, differs across cycles; msUntilNext boundary.
- [ ] Implement, pass, commit.

### Task 6: Token overrides (pure) — `src/client/tokens.ts`

**Produces:**
```ts
export const SURFACE_TOKENS: readonly string[]   // bg-base, bg-layer-1, sidebar-fill
export const FLOATING_TOKENS: readonly string[]  // bg-layer-2, bg-layer-3, bg-overlay, bg-module-platform
export const FALLBACK_VALUES: { light: Record<string,string>; dark: Record<string,string> }
export function translucent(value: string, alpha: number): string   // color-mix(...), alpha 1 → value unchanged
export function buildOverrides(base: {light, dark}, opacity: number): Record<string, {light: string; dark: string}>
export function readBaseFromRules(rules: Iterable<{selectorText?: string; style?: {getPropertyValue(n:string):string}}>): {light, dark}  // fills missing from fallback
```
- [ ] Tests: surface alpha = opacity; floating alpha = max(opacity, 0.9); both modes present; opacity 1 → raw values; rule scan picks body vs dark selector; missing → fallback.
- [ ] Implement, pass, commit.

### Task 7: Browser runtime — `src/client/state-client.ts`, `stage.ts`, `transparency.ts`, `controller.ts`, `index.ts`

- [ ] `state-client.ts`: `createStateClient(fetchImpl)` → `{ getSnapshot(): {state, info, status}, subscribe, refresh(), send(op): Promise<{ok:true}|{ok:false,error:string}> }`; 409 → adopt + retry once. Test with a fake fetch (`tests/state-client.test.js`): optimistic apply, 409 retry, network failure keeps state, add error surfaces message.
- [ ] `stage.ts` (DOM): two layers, crossfade, fit/tile/position/blur, `show(item): Promise<boolean>` resolves false on load error; `dispose()`.
- [ ] `transparency.ts` (DOM): `enable(opacity)`, `disable()`; style tag + `html[data-dsh-bg]` + `theme.overrideTokens`.
- [ ] `controller.ts`: subscribes to state-client, builds pool, picks, shows, schedules next, error fallback; exposes `current`.
- [ ] `index.ts`: `inject = ['slots', 'theme']`, wire everything with `ctx.effect`, devtools `window.__dshBackground__`.
- [ ] Build, commit.

### Task 8: Settings tab — `src/client/settings-tab.tsx`, `src/client/styles.ts`

- [ ] Register `settings.section` id `background` order 50 label `Background`, `inject: () => ({ client })`.
- [ ] Add row, grid (None + entries, thumbnails, count badge, ⚠, hover actions ⟳ ✎ 🗑), inline editor for label + overrides with "use global", appearance sliders (live preview, 300 ms debounce save), fit/position segmented controls, rotation switch/interval/order.
- [ ] Build, commit.

### Task 9: README, install, verify

- [ ] README (what, install, settings, how it works, dev).
- [ ] `pnpm test && pnpm build`.
- [ ] `dsh plugin --profile web add file:/Users/halp/code/dsh/dsh-plugin-background`; confirm profile `package.json` + bundles list include it.
- [ ] Restart dsh web if running (ask user if it's their live session), load in Chrome, add a URL + a folder, screenshot.
- [ ] Final commit; whole-branch review by a fresh reviewer.
