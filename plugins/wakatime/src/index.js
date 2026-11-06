/**
 * dsh-plugin-wakatime: send a WakaTime heartbeat whenever the agent reads or
 * edits a file.
 *
 * The fs tools (read, write, edit, read_image, str_replace_editor) emit
 * `fs/observed` with the resolved target and the tool execution, so that one
 * event carries everything a heartbeat needs. Heartbeats go through
 * `wakatime-cli`, which owns auth, offline queueing, and project detection.
 *
 * @module dsh-plugin-wakatime
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'wakatime';

export const inject = ['fs'];

const VERSION = '0.1.0';

/** Version of the running dsh host, read from the CLI package that launched us. */
function hostVersion() {
  try {
    const require = createRequire(process.argv[1] ?? import.meta.url);
    return require('@deepseek-ai/dsh/package.json').version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** WakaTime reads the editor name from the first `name/version` token. */
export const PLUGIN_TAG = `Deepseek Harness/${hostVersion()} dsh-plugin-wakatime/${VERSION}`;

/** Same file within this window is not re-sent unless it is a write. */
export const HEARTBEAT_INTERVAL_MS = 2 * 60_000;

const WRITE_TOOLS = new Set(['write', 'edit']);

/** Default CLI: the one editor plugins install, else whatever is on PATH. */
function defaultCliPath() {
  const home = process.env.WAKATIME_HOME ?? homedir();
  const managed = join(home, '.wakatime', 'wakatime-cli');
  return existsSync(managed) ? managed : 'wakatime-cli';
}

/**
 * Validate and default the plugin config.
 * @param raw - the user's config section.
 * @returns the resolved, immutable config.
 */
export function resolveConfig(raw = {}) {
  const optionalString = (key) => {
    const value = raw[key];
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw new Error(`wakatime: ${key} must be a string`);
    return value;
  };

  const apiUrl = optionalString('apiUrl');
  if (apiUrl !== undefined && (!URL.canParse(apiUrl) || !/^https?:/u.test(apiUrl))) {
    throw new Error(`wakatime: apiUrl must be an http(s) URL, got ${JSON.stringify(apiUrl)}`);
  }

  return Object.freeze({
    enabled: raw.enabled ?? true,
    apiUrl,
    apiKey: optionalString('apiKey'),
    cliPath: optionalString('cliPath') ?? defaultCliPath(),
    category: optionalString('category') ?? 'ai coding',
  });
}

/**
 * Whether a tool execution changed the file it observed.
 * @param exec - the tool execution passed as the `fs/observed` actor.
 */
export function isWrite(exec) {
  const tool = exec?.name;
  if (WRITE_TOOLS.has(tool)) return true;
  if (tool === 'str_replace_editor') return exec.arguments?.command !== 'view';
  return false;
}

/**
 * Build the wakatime-cli argument list for one heartbeat.
 * @param entity - absolute file path.
 * @param write - whether the file was modified.
 * @param config - resolved config.
 */
export function buildArgs(entity, write, config) {
  const args = ['--entity', entity, '--entity-type', 'file', '--category', config.category, '--plugin', PLUGIN_TAG];
  if (write) args.push('--write');
  if (config.apiUrl !== undefined) args.push('--api-url', config.apiUrl);
  if (config.apiKey !== undefined) args.push('--key', config.apiKey);
  return args;
}

/**
 * The standard editor-plugin throttle: send on a new file, on a write, or once
 * the interval has passed for the same file.
 */
export function createThrottle(intervalMs = HEARTBEAT_INTERVAL_MS) {
  let last;
  return (entity, write, now = Date.now()) => {
    const send = write || last === undefined || last.entity !== entity || now - last.time >= intervalMs;
    if (send) last = { entity, time: now };
    return send;
  };
}

/**
 * Wire heartbeats to `fs/observed`.
 * @param ctx - the plugin context.
 * @param rawConfig - the user's config section.
 * @param run - process runner, injectable for tests.
 */
export function apply(ctx, rawConfig = {}, run = execFile) {
  const config = resolveConfig(rawConfig);
  const logger = ctx.logger('wakatime');
  if (!config.enabled) {
    logger.info('wakatime: disabled by config');
    return;
  }

  const shouldSend = createThrottle();
  let missingCliReported = false;

  const send = (entity, write) => {
    run(config.cliPath, buildArgs(entity, write, config), { timeout: 30_000, windowsHide: true }, (error, _stdout, stderr) => {
      if (error === null || error === undefined) return;
      if (error.code === 'ENOENT') {
        if (!missingCliReported) logger.warn(`wakatime: wakatime-cli not found at ${config.cliPath}; set cliPath or install it`);
        missingCliReported = true;
        return;
      }
      const detail = String(stderr ?? '').trim() || error.message;
      logger.warn(`wakatime: heartbeat failed (exit ${error.code}): ${detail}`);
    });
  };

  // Listeners on fs/observed must be synchronous and must not throw: a throw
  // fails the tool call that emitted it.
  ctx.on('fs/observed', (target, observation, exec) => {
    try {
      if (observation?.kind !== 'present') return;
      const entity = ctx.fs.processPath(target);
      if (typeof entity !== 'string' || entity === '') return;
      const write = isWrite(exec);
      if (shouldSend(entity, write)) send(entity, write);
    } catch (error) {
      logger.warn(`wakatime: could not record activity: ${error?.message ?? error}`);
    }
  }, { global: true });

  logger.info(`wakatime: tracking file activity via ${config.cliPath}${config.apiUrl === undefined ? '' : ` (${config.apiUrl})`}`);
}
