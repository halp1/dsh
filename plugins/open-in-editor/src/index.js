/**
 * dsh-plugin-open-in-editor, node half.
 *
 * Two routes on the composition's `webServer`, both behind the `connection`
 * service's Host/Origin fence and browser authentication (the same gate the
 * built-in open-in-app routes use):
 *
 * - `GET  /open-in-editor/config` — what the browser half needs to route a
 *   click: whether an editor resolved, which extensions stay in the sidebar,
 *   and whether remote (non-loopback) pages are routed too.
 * - `POST /open-in-editor/open`   — `{ path, line?, workspace? }`: opens one
 *   existing regular file in the editor, at `line` when given. `workspace`
 *   (the session's cwd) is passed along so the editor reuses/opens the window
 *   for that folder when the file lives inside it.
 *
 * The browser half lives in ./client.js.
 * @module dsh-plugin-open-in-editor
 */

import { spawn } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';

/** Stable Cordis plugin name. */
export const name = 'open-in-editor';

/** Host services the routes need. */
export const inject = ['webServer', 'connection'];

/** Route paths (the browser uses them document-relative, without the slash). */
export const CONFIG_PATH = '/open-in-editor/config';
export const OPEN_PATH = '/open-in-editor/open';

/**
 * Extensions that keep opening in the sidebar preview: Markdown, plus formats
 * the sidebar renders and a code editor does not (images, PDF, Office,
 * spreadsheets).
 */
export const DEFAULT_SIDEBAR_EXTENSIONS = Object.freeze([
  'md', 'markdown', 'mdx',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg',
  'pdf',
  'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'tsv',
]);

/** VS Code CLI candidates, in preference order (stable before Insiders). */
function defaultCandidates() {
  const home = homedir();
  const bundles = [
    'Visual Studio Code.app',
    'Visual Studio Code - Insiders.app',
  ];
  const bundleBins = bundles.flatMap(bundle => [
    join('/Applications', bundle, 'Contents/Resources/app/bin/code'),
    join(home, 'Applications', bundle, 'Contents/Resources/app/bin/code'),
  ]);
  // Plain names are looked up on PATH; stable first.
  return ['code', bundleBins[0], bundleBins[1], 'code-insiders', bundleBins[2], bundleBins[3]];
}

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Validate and default the row config.
 * @param {Record<string, unknown> | undefined} raw - profile row config.
 * @returns {{ command: string | undefined, sidebarExtensions: string[], localOnly: boolean, openWorkspace: boolean, launchWatchMs: number }}
 */
export function resolveConfig(raw) {
  const config = raw ?? {};
  const { command, sidebarExtensions, localOnly = true, openWorkspace = true, launchWatchMs = 3000 } = config;
  if (command !== undefined && (typeof command !== 'string' || command === '')) {
    throw new Error('open-in-editor: config.command must be a non-empty string');
  }
  if (sidebarExtensions !== undefined && (!Array.isArray(sidebarExtensions) || sidebarExtensions.some(e => typeof e !== 'string'))) {
    throw new Error('open-in-editor: config.sidebarExtensions must be a list of strings');
  }
  if (typeof localOnly !== 'boolean') throw new Error('open-in-editor: config.localOnly must be a boolean');
  if (typeof openWorkspace !== 'boolean') throw new Error('open-in-editor: config.openWorkspace must be a boolean');
  if (!Number.isInteger(launchWatchMs) || launchWatchMs < 1 || launchWatchMs > 60000) {
    throw new Error('open-in-editor: config.launchWatchMs must be an integer between 1 and 60000');
  }
  return {
    command,
    sidebarExtensions: (sidebarExtensions ?? DEFAULT_SIDEBAR_EXTENSIONS).map(e => e.toLowerCase().replace(/^\./, '')),
    localOnly,
    openWorkspace,
    launchWatchMs,
  };
}

/**
 * Find an executable: absolute paths are checked directly, bare names on PATH.
 * @param {string[]} candidates - commands in preference order.
 * @param {string | undefined} pathEnv - the PATH to search.
 * @returns {Promise<string | undefined>} the first executable found.
 */
export async function resolveEditor(candidates, pathEnv = process.env.PATH) {
  const dirs = (pathEnv ?? '').split(delimiter).filter(Boolean);
  for (const candidate of candidates) {
    const options = isAbsolute(candidate) ? [candidate] : dirs.map(dir => join(dir, candidate));
    for (const file of options) {
      try {
        await access(file, constants.X_OK);
        if ((await stat(file)).isFile()) return file;
      } catch { /* try the next one */ }
    }
  }
  return undefined;
}

/**
 * The editor CLI argv for one file.
 * @param {{ path: string, line?: number, workspace?: string }} target - file, 1-based line, session cwd.
 * @param {boolean} openWorkspace - pass the workspace folder when the file is inside it.
 * @returns {string[]} arguments after the command.
 */
export function editorArgs(target, openWorkspace) {
  const args = [];
  if (openWorkspace && target.workspace !== undefined && isInside(target.workspace, target.path)) {
    args.push(target.workspace);
  }
  args.push('-g', `${target.path}:${target.line ?? 1}`);
  return args;
}

/** Whether `file` lies inside directory `dir`. */
function isInside(dir, file) {
  const rel = relative(dir, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Spawn the editor CLI detached and watch it briefly. The VS Code CLI hands
 * the request to the running instance and exits 0 quickly; a non-zero exit or
 * spawn error inside the window is a failure, still running is a success.
 * @returns {Promise<boolean>} whether the launch counted as successful.
 */
function launch(command, args, watchMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    let child;
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => done(true), watchMs);
    child.once('error', () => done(false));
    child.once('exit', code => done(code === 0));
    child.unref();
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

/**
 * Validate one open body.
 * @param {string} text - request body.
 * @returns {{ path: string, line?: number, workspace?: string } | string} the target, or an error message.
 */
export function parseOpenBody(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return 'body must be JSON';
  }
  if (typeof body !== 'object' || body === null) return 'body must be a JSON object';
  const { path, line, workspace } = body;
  if (typeof path !== 'string' || path === '' || !isAbsolute(path)) return '"path" must be an absolute path';
  if (/[\u0000-\u001f\u007f]/.test(path)) return '"path" contains control characters';
  if (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) return '"line" must be a positive integer';
  if (workspace !== undefined && (typeof workspace !== 'string' || !isAbsolute(workspace))) return '"workspace" must be an absolute path';
  return {
    path,
    ...(line === undefined ? {} : { line }),
    ...(workspace === undefined ? {} : { workspace }),
  };
}

/**
 * Host plugin body.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown> | undefined} rawConfig - row config.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  /** Resolved once per plugin life; a failed launch clears it so a reinstall heals. */
  let editor;
  const editorPath = () => editor ??= resolveEditor(config.command === undefined ? defaultCandidates() : [config.command]);

  const rejected = (req, res) => {
    const rejection = Reflect.get(ctx, 'connection').requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONFIG_PATH,
    handler: async (req, res) => {
      if (rejected(req, res)) return;
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('allow', 'GET');
        res.end();
        return;
      }
      const command = await editorPath();
      sendJson(res, 200, {
        available: command !== undefined,
        sidebarExtensions: config.sidebarExtensions,
        localOnly: config.localOnly,
      });
    },
  }), `open-in-editor: GET ${CONFIG_PATH}`);

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_PATH,
    handler: async (req, res) => {
      if (rejected(req, res)) return;
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('allow', 'POST');
        res.end();
        return;
      }
      if (String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        sendJson(res, 415, { code: 'unsupported-media-type', message: 'content-type must be application/json' });
        return;
      }
      let text;
      try {
        text = await readBody(req);
      } catch {
        sendJson(res, 400, { code: 'bad-request', message: 'request body unreadable' });
        return;
      }
      if (text === null) {
        sendJson(res, 413, { code: 'payload-too-large', message: 'request body is too large' });
        return;
      }
      const target = parseOpenBody(text);
      if (typeof target === 'string') {
        sendJson(res, 400, { code: 'bad-request', message: target });
        return;
      }
      let isFile = false;
      try {
        isFile = (await stat(target.path)).isFile();
      } catch { /* missing */ }
      if (!isFile) {
        // The browser falls back to the sidebar, which explains missing paths
        // and handles directories.
        sendJson(res, 404, { code: 'not-a-file', message: `not an existing file: ${target.path}` });
        return;
      }
      const command = await editorPath();
      if (command === undefined) {
        sendJson(res, 503, { code: 'no-editor', message: 'no VS Code CLI found; set config.command' });
        return;
      }
      if (await launch(command, editorArgs(target, config.openWorkspace), config.launchWatchMs)) {
        sendJson(res, 200, { ok: true });
        return;
      }
      editor = undefined;
      sendJson(res, 502, { code: 'launch-failed', message: `failed to launch ${command}` });
    },
  }), `open-in-editor: POST ${OPEN_PATH}`);
}
