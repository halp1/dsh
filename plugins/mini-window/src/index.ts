/** Authenticated node host for the separate Electron mini-window companion. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { HostConnectionHandle, ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { StateStore, defaultStateFile, expandHome, userDataDirectory } from './host/store.mjs'
import { NativeRuntime } from './host/runtime.mjs'
import { MiniWindowController } from './host/controller.mjs'
import { createRoutes } from './host/routes.mjs'
import { MiniModels } from './host/models.mjs'

export const name = 'mini-window'
export const inject = ['connection', 'webServer', 'sessions', 'sessionPersistence', 'sessionController', 'workspaceRegistry']
export interface Config {
  /** Defaults to $DSH_HOME/plugins/mini-window/state.json. */
  stateFile?: string
  /** An already-installed executable; activation never downloads Electron. */
  electronPath?: string
}

export const Config = z.object({
  stateFile: z.string().required(false).description('Private mini-window state file (defaults under DSH_HOME).'),
  electronPath: z.string().required(false).description('Path to an already-installed Electron executable.'),
})

export function apply(ctx: Context, config: Config = {}): void {
  const connection = ctx.get('connection') as HostConnectionHandle
  const server = ctx.get('webServer') as { port: number }
  const profile = ctx.get('profileContext') as { dir?: string; home?: string; installAnchor?: string } | undefined
  const launch = ctx.get('launchEnvironment') as { get(name: string): { value: string } | undefined } | undefined
  const env = { ...process.env }
  for (const key of ['DSH_HOME', 'ELECTRON_PATH']) {
    const value = launch?.get(key)?.value
    if (value !== undefined) env[key] = value
  }
  const file = config.stateFile?.trim() ? resolve(expandHome(config.stateFile.trim())) : defaultStateFile(env)
  const anchors = [import.meta.url]
  if (profile?.dir) anchors.push(pathToFileURL(resolve(profile.dir, 'package.json')).href)
  if (profile?.installAnchor) anchors.push(pathToFileURL(resolve(profile.installAnchor)).href)
  const store = new StateStore(file)
  const native = new NativeRuntime({
    electronPath: config.electronPath?.trim() ? expandHome(config.electronPath.trim()) : undefined,
    env, anchors,
    // Survives profile reinstalls, which drop the electron package's dist/.
    runtimeDir: resolve(dirname(file), 'electron'),
    // Built lib/index.js resolves this to the package's native/main.cjs.
    mainPath: fileURLToPath(new URL('../native/main.cjs', import.meta.url)),
    userDataDir: userDataDirectory(file, profile?.dir),
    authenticatedUrl: () => connection.authenticatedUrl(`http://127.0.0.1:${server.port}/`),
  })
  const controller = new MiniWindowController(store, native)
  for (const route of createRoutes(controller, new MiniModels(ctx, controller))) {
    ctx.effect(() => connection.fetch.register(route as ConnectionFetchRoute), `mini-window: ${route.path}`)
  }
  ctx.effect(() => () => controller.dispose(), 'mini-window: native companion')
  // Starts hidden when enabled to register the global shortcut. Startup errors
  // live in the private authenticated snapshot; never log bootstrap credentials.
  void controller.activate().catch(error => native.error(error))
}
