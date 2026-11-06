/**
 * Build config for both halves.
 *
 * The node half is an ordinary ESM library. The browser half must match the
 * artifact shape the DSH client module system loads: a script whose whole body
 * is a closure registered through `window.__ModuleLoader__.load({id, factory})`,
 * where `factory(require)` returns the exports and every platform module
 * (react, cordis, the primitives) is resolved through the injected `require`
 * rather than bundled. Styles are a plain string injected at runtime
 * (src/client/styles.ts), so there is no CSS pipeline.
 */
import type { UserConfig } from 'tsdown'

/** Plugin id: the package name, stamped into the loader handoff. */
const ID = 'dsh-plugin-quickswitcher'

/**
 * The host's platform seed: the specifiers the browser module table answers
 * at runtime. Bundling any of them would duplicate singletons the rest of the
 * UI shares (React above all), so they stay external.
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
  '@deepseek-ai/dsh-client-ui-dockkit',
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
  // Lands next to the node half, so `clean` stays off.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  minify: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
  plugins: [{
    // A cross-plugin value import either duplicates a runtime instance or
    // requests a specifier the module table cannot answer. Host services are
    // reached through ctx, and their types are declared in src/client/host.ts.
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (PLATFORM_MODULES.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module. Collaborate through cordis services instead.`,
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
