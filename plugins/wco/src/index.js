/**
 * dsh-plugin-wco: Window Controls Overlay for an installed DeepSeek Harness PWA.
 *
 * Two halves, both registered on the web server:
 *
 * 1. **Manifest.** An exact route for `/manifest.webmanifest` serves the
 *    shell's own manifest with `display_override: ["window-controls-overlay",
 *    …]` added. Named routes are matched before the static fallback, so this
 *    replaces the shipped file without touching it on disk. That is what tells
 *    Chromium to drop the title bar and draw only the window controls.
 * 2. **Page runtime.** Index injection rows add a head script that reads
 *    `navigator.windowControlsOverlay` and maps its geometry onto the layout
 *    contract DSH already has for the Windows desktop shell's caption band,
 *    plus a small stylesheet. See `page.js`.
 *
 * In a normal browser tab neither half changes anything visible: the manifest
 * only matters to installed apps, and the runtime does nothing without a
 * visible overlay.
 *
 * @module dsh-plugin-wco
 */

import { MANIFEST_PATH, createManifestHandler, locateBaseManifest } from './manifest.js';
import { BASE_CSS, pageScriptText } from './page.js';

export { MANIFEST_PATH, patchManifest, locateBaseManifest, readBaseManifest } from './manifest.js';
export { BASE_CSS, GLOBAL_NAME, SETTINGS_KEY, installWcoRuntime, pageScriptText } from './page.js';

/** Stable Cordis plugin name. */
export const name = 'wco';

/** The web server is the only dependency. */
export const inject = ['webServer'];

/** Display modes Chromium understands in `display_override`. */
const DISPLAY_MODES = new Set([
  'window-controls-overlay',
  'tabbed',
  'borderless',
  'fullscreen',
  'standalone',
  'minimal-ui',
  'browser',
]);

/** Defaults: overlay first, then the ordinary app window. */
export const DEFAULTS = Object.freeze({
  manifest: true,
  layout: true,
  themeColor: true,
  displayOverride: Object.freeze(['window-controls-overlay', 'standalone']),
  baseManifest: undefined,
  manifestFields: Object.freeze({}),
});

/**
 * Validate and default the plugin config.
 *
 * - `manifest` (bool): serve the patched manifest.
 * - `layout` (bool): inject the page runtime.
 * - `themeColor` (bool): keep the overlay's colour on the caption band fill.
 * - `displayOverride` (string[]): the fallback chain, in order.
 * - `baseManifest` (string): explicit path to the manifest to patch.
 * - `manifestFields` (object): extra top-level manifest fields to set.
 *
 * @param raw - the row's config.
 * @returns the resolved config.
 */
export function resolveConfig(raw = {}) {
  const config = { ...DEFAULTS, ...(raw ?? {}) };
  for (const key of ['manifest', 'layout', 'themeColor']) {
    if (typeof config[key] !== 'boolean') throw new Error(`wco: ${key} must be a boolean`);
  }
  if (!Array.isArray(config.displayOverride) || config.displayOverride.length === 0) {
    throw new Error('wco: displayOverride must be a non-empty array');
  }
  for (const mode of config.displayOverride) {
    if (!DISPLAY_MODES.has(mode)) {
      throw new Error(`wco: unknown display mode "${mode}" (expected one of ${[...DISPLAY_MODES].join(', ')})`);
    }
  }
  if (config.baseManifest !== undefined && typeof config.baseManifest !== 'string') {
    throw new Error('wco: baseManifest must be a path string');
  }
  if (typeof config.manifestFields !== 'object' || config.manifestFields === null || Array.isArray(config.manifestFields)) {
    throw new Error('wco: manifestFields must be an object');
  }
  return config;
}

/**
 * Host plugin body.
 * @param ctx - Cordis context carrying `webServer`.
 * @param rawConfig - the row's config.
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const logger = typeof ctx.logger === 'function' ? ctx.logger('wco') : console;

  if (config.manifest) {
    const basePath = locateBaseManifest(config.baseManifest);
    if (basePath === undefined) {
      logger.warn('wco: shell manifest not found; serving the built-in copy with display_override added');
    }
    const handler = createManifestHandler({
      basePath,
      displayOverride: config.displayOverride,
      manifest: config.manifestFields,
    });
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: MANIFEST_PATH, handler }),
      'wco: manifest route',
    );
  }

  if (config.layout) {
    // Built once: the rows are pure functions of config.
    const rows = [
      { kind: 'style', text: BASE_CSS },
      { kind: 'script', placement: 'head', text: pageScriptText({ themeColor: config.themeColor }) },
    ];
    ctx.on('webserver/index-inject', (table) => {
      table.push(...rows);
    });
  }
}
