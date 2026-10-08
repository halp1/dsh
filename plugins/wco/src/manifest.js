/**
 * The web app manifest half: find the shell's own manifest, add the
 * `display_override` chain that opts an installed PWA into Window Controls
 * Overlay, and serve the result at the URL the shell's index already links.
 *
 * The shell ships `dist/manifest.webmanifest` with `"display": "fullscreen"`
 * and no `display_override`, so an installed DSH window always gets the
 * browser's full-width title bar. Chromium only draws the overlay when the
 * manifest's `display_override` lists `window-controls-overlay`, which is why
 * this cannot be done from the page alone.
 *
 * @module dsh-plugin-wco/manifest
 */

import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Pathname the shell's index links (`<link rel="manifest" href="./manifest.webmanifest">`). */
export const MANIFEST_PATH = '/manifest.webmanifest';

/** Package-export specifier of the shell's shipped manifest. */
export const BASE_MANIFEST_SPECIFIER = '@deepseek-ai/dsh-web-frontend/dist/manifest.webmanifest';

/**
 * Copy of the manifest dsh 0.2.0-rc.2 ships. Used only when the real one
 * cannot be located or parsed, so the route never answers with an error: a
 * broken manifest would make Chrome treat the installed app as un-updatable.
 */
export const FALLBACK_BASE_MANIFEST = Object.freeze({
  name: 'DeepSeek Harness',
  short_name: 'DSH',
  start_url: './',
  scope: './',
  display: 'fullscreen',
  icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
});

/**
 * Candidate files to resolve the frontend package from, most specific first:
 * this package (works when the profile hoists the frontend next to it), the
 * running `dsh` binary (the frontend is one of its dependencies), the profile
 * directory, and the working directory.
 * @param env - process environment.
 * @returns absolute anchor paths or file URLs.
 */
function resolutionAnchors(env) {
  const anchors = [import.meta.url];
  if (typeof process.argv[1] === 'string' && process.argv[1] !== '') {
    try {
      // The bin is usually a symlink (…/bin/dsh -> …/lib/node_modules/@deepseek-ai/dsh/lib/bin.js);
      // resolution must start from the real file to reach dsh's node_modules.
      anchors.push(realpathSync(process.argv[1]));
    } catch {
      anchors.push(process.argv[1]);
    }
  }
  if (env.DSH_PROFILE_DIR) anchors.push(join(env.DSH_PROFILE_DIR, 'package.json'));
  anchors.push(join(process.cwd(), 'package.json'));
  return anchors;
}

/**
 * Locate the shell's shipped manifest file.
 * @param explicit - a configured path, which wins outright.
 * @param env - process environment (injectable for tests).
 * @returns the absolute path, or undefined when no anchor can resolve it.
 */
export function locateBaseManifest(explicit, env = process.env) {
  if (typeof explicit === 'string' && explicit !== '') return explicit;
  for (const anchor of resolutionAnchors(env)) {
    try {
      return createRequire(anchor).resolve(BASE_MANIFEST_SPECIFIER);
    } catch {
      // Not resolvable from this anchor; try the next one.
    }
  }
  return undefined;
}

/**
 * Read the base manifest, falling back to the built-in copy on any failure.
 * Read per request on purpose: the file is tiny, and re-reading means a `dsh`
 * upgrade that changes the shell's manifest is picked up without a restart.
 * @param path - located manifest path, or undefined.
 * @returns the parsed base manifest object.
 */
export async function readBaseManifest(path) {
  if (path === undefined) return { ...FALLBACK_BASE_MANIFEST };
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
  } catch {
    // Missing or corrupt: serve the known-good copy instead of an error.
  }
  return { ...FALLBACK_BASE_MANIFEST };
}

/**
 * Apply the plugin's changes to a base manifest.
 *
 * The configured `display_override` entries come first, then any entries the
 * shell may add in a future release (deduplicated). `display` is left alone:
 * it is only the last resort for browsers that understand none of the
 * overrides, and the shell owns that choice.
 *
 * @param base - the shell's manifest.
 * @param options - `displayOverride` chain and `manifest` field overrides.
 * @returns a new manifest object.
 */
export function patchManifest(base, { displayOverride, manifest = {} }) {
  const existing = Array.isArray(base.display_override) ? base.display_override : [];
  return {
    ...base,
    display_override: [...new Set([...displayOverride, ...existing])],
    ...manifest,
  };
}

/**
 * Build the node:http handler for {@link MANIFEST_PATH}.
 * @param options - manifest path, display chain and field overrides.
 * @returns a route handler.
 */
export function createManifestHandler({ basePath, displayOverride, manifest }) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const body = JSON.stringify(
      patchManifest(await readBaseManifest(basePath), { displayOverride, manifest }),
      null,
      2,
    );
    res.writeHead(200, {
      'content-type': 'application/manifest+json',
      // Chromium compares the fetched manifest against the installed copy on
      // app navigation; a cached body would hide config changes.
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
