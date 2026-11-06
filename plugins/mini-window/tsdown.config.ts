import type { UserConfig } from 'tsdown'
const id = 'dsh-plugin-mini-window'
const platform = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']
const node: UserConfig = { entry: ['src/index.ts'], outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024', dts: false, clean: false, fixedExtension: false }
const client: UserConfig = {
  entry: { client: 'src/client/index.tsx' }, outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2024', dts: false, clean: false, minify: true, sourcemap: true,
  external: platform, noExternal: (name: string) => platform.includes(name) ? undefined : true,
  plugins: [{ name: 'dsh-client-purity', resolveId(source: string) { if (source.startsWith('@deepseek-ai/') && !platform.includes(source)) throw new Error(`Use Cordis services, not a runtime cross-plugin import: ${source}`); return null } }],
  outputOptions: { entryFileNames: 'client.js', banner: `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{`, intro: 'var module={exports:{}}; var exports=module.exports;', footer: 'return module.exports;}});' }
}
export default [node, client]
