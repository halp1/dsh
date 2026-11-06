/**
 * Build config for both halves.
 *
 * The node half is an ordinary ESM library. The browser half must match the
 * artifact shape the DSH client module system loads: a script whose whole body
 * is a closure registered through `window.__ModuleLoader__.load({id, factory})`,
 * where `factory(require)` returns the exports and every platform module
 * (react, cordis, the slot/store runtimes) is resolved through the injected
 * `require` rather than imported. That preset is not published, so this file
 * reproduces the format — minus the CSS-modules pipeline, which this plugin
 * does not need because it renders nothing.
 */
import type { UserConfig } from 'tsdown'

/** Plugin id: the package name, stamped into the loader handoff. */
const ID = 'dsh-plugin-badge'

/**
 * The host's platform seed — the specifiers the browser module table answers at
 * runtime. A bundle must keep these external (require) instead of inlining, or
 * it would duplicate singletons the rest of the UI shares. This plugin only
 * actually requires `@deepseek-ai/cordis`, but the full list is kept so the
 * externals rule matches the platform rather than this package's current
 * imports.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** Node half: the Loader-facing plugin row. */
const node: UserConfig = {
  name: ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/** Browser half: the closure-factory artifact the client module system loads. */
const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // Lands next to the node half; `clean` must stay off so it does not wipe it.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  minify: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  // tsdown auto-externalizes dependencies; anything the module table cannot
  // answer must inline instead, so the rule is the table list itself.
  noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
  plugins: [{
    // Build-time mirror of the module-edge rules: a cross-plugin value import
    // either duplicates a runtime instance or requests a specifier the frozen
    // module table cannot answer. This plugin's @deepseek-ai imports are all
    // type-only (erased before this gate sees them), so any hit here is a real
    // regression.
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (PLATFORM_MODULES.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module — cross-plugin value imports are `
        + 'forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [node, client]
