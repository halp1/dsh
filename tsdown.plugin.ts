/**
 * Shared tsdown build for plugins with a browser half.
 *
 * The node half is an ordinary ESM library. The browser half must match the
 * artifact shape the DSH client module system loads: a script whose whole body
 * is a closure registered through `window.__ModuleLoader__.load({id, factory})`,
 * where `factory(require)` returns the exports and every platform module is
 * resolved through the injected `require` rather than bundled. That preset is
 * not published, so this file reproduces the format without a CSS pipeline.
 * Plugins that need styles inject plain strings at runtime.
 */
import type { UserConfig } from 'tsdown'

/**
 * The host's platform seed: the specifiers the browser module table answers at
 * runtime. Bundling any of them would duplicate singletons the rest of the UI
 * shares (React above all), so they stay external.
 */
export const PLATFORM_MODULES = [
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

export interface PluginBuildOptions {
  /** Package name, stamped into the loader handoff. */
  id: string
  /** Browser entry, relative to the plugin root. */
  clientEntry: string
  /** Node entry, relative to the plugin root. */
  nodeEntry?: string
}

/**
 * Build both halves of a DSH plugin into `lib/index.js` and `lib/client.js`.
 * @param options - the plugin id and entries.
 * @returns the node and browser configs, in that order.
 */
export function dshPluginBuild({ id, clientEntry, nodeEntry = 'src/index.ts' }: PluginBuildOptions): UserConfig[] {
  const node: UserConfig = {
    name: id,
    entry: [nodeEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }

  const client: UserConfig = {
    name: `${id}/client`,
    entry: { client: clientEntry },
    // Lands next to the node half, so `clean` must stay off.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: true,
    minify: true,
    clean: false,
    external: [...PLATFORM_MODULES],
    // tsdown auto-externalizes dependencies. Anything the module table cannot
    // answer must inline instead, so the rule is the table list itself.
    noExternal: (source: string) => (PLATFORM_MODULES.includes(source) ? undefined : true),
    plugins: [{
      // A cross-plugin value import either duplicates a runtime instance or
      // requests a specifier the module table cannot answer. Type-only imports
      // are erased before this gate sees them.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (PLATFORM_MODULES.includes(source)) return null
        throw new Error(`client bundle purity: "${source}" is not a platform module. Collaborate through cordis services instead.`)
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }

  return [node, client]
}
