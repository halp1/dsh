/**
 * Supervises the native `lidwatch` helper and turns its JSON lines into
 * events. Also runs a clock-jump watchdog: a sleep that the helper failed to
 * report still shows up as a gap between interval ticks.
 *
 * @module dsh-plugin-lid-pause/watcher
 */

import { spawn as nodeSpawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_PATH = join(PACKAGE_ROOT, 'native', 'lidwatch.swift');
export const BUNDLED_BINARY = join(PACKAGE_ROOT, 'lib', 'lidwatch');

/**
 * Split a byte stream into complete lines, keeping the partial tail.
 * @returns a push function that returns the complete lines seen so far.
 */
export function lineSplitter() {
  let tail = '';
  return (chunk) => {
    tail += chunk;
    const lines = tail.split('\n');
    tail = lines.pop() ?? '';
    return lines.filter((line) => line.trim() !== '');
  };
}

/**
 * Parse one helper line into an event, or undefined when it is not one.
 */
export function parseEvent(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  switch (value.type) {
    case 'snapshot':
      return {
        type: 'snapshot',
        lidClosed: value.lidClosed === true,
        networkUp: value.networkUp !== false,
        interfaces: Array.isArray(value.interfaces) ? value.interfaces : [],
      };
    case 'lid':
      return typeof value.closed === 'boolean' ? { type: 'lid', closed: value.closed } : undefined;
    case 'power':
      return value.state === 'will-sleep' || value.state === 'did-wake'
        ? { type: 'power', state: value.state }
        : undefined;
    case 'network':
      return typeof value.up === 'boolean'
        ? { type: 'network', up: value.up, interfaces: Array.isArray(value.interfaces) ? value.interfaces : [] }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Locate the helper binary, compiling it once into the cache when the package
 * was installed without a prebuilt copy.
 */
export async function resolveBinary({ logger, cacheDir = defaultCacheDir() } = {}) {
  if (existsSync(BUNDLED_BINARY)) return BUNDLED_BINARY;
  const source = await readFile(SOURCE_PATH);
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 8);
  const target = join(cacheDir, `lidwatch-${digest}`);
  if (existsSync(target)) return target;

  await mkdir(join(cacheDir, 'module-cache'), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  logger?.info(`lid-pause: compiling native helper into ${target}`);
  await new Promise((resolve, reject) => {
    execFile(
      'swiftc',
      ['-O', '-module-cache-path', join(cacheDir, 'module-cache'), SOURCE_PATH, '-o', tmp],
      { timeout: 180_000 },
      (error, _stdout, stderr) => (error ? reject(new Error(`swiftc failed: ${stderr || error.message}`)) : resolve()),
    );
  });
  await rename(tmp, target);
  return target;
}

function defaultCacheDir() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return join(home, 'plugins', 'lid-pause');
}

export class LidWatcher {
  /**
   * @param options.binary - helper path.
   * @param options.onEvent - receives each parsed event.
   * @param options.logger - cordis logger.
   * @param options.spawn - child_process.spawn, injectable for tests.
   * @param options.sleepDelayMs - how long the helper holds sleep for us.
   * @param options.watchdogMs - clock-jump check interval, 0 disables.
   * @param options.jumpMs - gap that counts as a missed sleep.
   * @param options.restartBaseMs - first restart delay, doubled up to 60s.
   */
  constructor({
    binary,
    onEvent,
    logger,
    spawn = nodeSpawn,
    sleepDelayMs = 1000,
    watchdogMs = 5000,
    jumpMs = 30_000,
    restartBaseMs = 1000,
    now = Date.now,
  }) {
    this.binary = binary;
    this.onEvent = onEvent;
    this.logger = logger;
    this.spawn = spawn;
    this.sleepDelayMs = sleepDelayMs;
    this.watchdogMs = watchdogMs;
    this.jumpMs = jumpMs;
    this.now = now;

    this.child = undefined;
    this.stopped = false;
    this.restartBaseMs = restartBaseMs;
    this.restartDelay = restartBaseMs;
    this.restartTimer = undefined;
    this.watchdog = undefined;
    this.lastTick = undefined;
  }

  start() {
    this.stopped = false;
    this.launch();
    if (this.watchdogMs > 0) {
      this.lastTick = this.now();
      this.watchdog = setInterval(() => this.tick(), this.watchdogMs);
      this.watchdog.unref?.();
    }
  }

  tick() {
    const now = this.now();
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (gap > this.jumpMs) {
      this.logger?.info(`lid-pause: clock jumped ${Math.round(gap / 1000)}s, treating as a wake`);
      this.deliver({ type: 'power', state: 'did-wake', synthetic: true });
    }
  }

  launch() {
    if (this.stopped) return;
    let child;
    try {
      child = this.spawn(this.binary, ['--sleep-delay-ms', String(this.sleepDelayMs)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.logger?.warn(`lid-pause: could not start helper: ${error.message}`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    const split = lineSplitter();
    let healthy = false;

    child.stdout.setEncoding?.('utf8');
    child.stdout.on('data', (chunk) => {
      for (const line of split(String(chunk))) {
        const event = parseEvent(line);
        if (event === undefined) {
          this.logger?.debug?.(`lid-pause: ignoring helper line ${JSON.stringify(line.slice(0, 200))}`);
          continue;
        }
        if (!healthy) {
          healthy = true;
          this.restartDelay = this.restartBaseMs;
        }
        this.deliver(event);
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) this.logger?.warn(`lid-pause helper: ${text.slice(0, 500)}`);
    });
    child.on('error', (error) => {
      this.logger?.warn(`lid-pause: helper error: ${error.message}`);
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (this.stopped) return;
      this.logger?.warn(`lid-pause: helper exited (${signal ?? code}); restarting in ${this.restartDelay / 1000}s`);
      this.scheduleRestart();
    });
  }

  scheduleRestart() {
    if (this.stopped || this.restartTimer !== undefined) return;
    const delay = this.restartDelay;
    this.restartDelay = Math.min(this.restartDelay * 2, 60_000);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.launch();
    }, delay);
    this.restartTimer.unref?.();
  }

  deliver(event) {
    try {
      this.onEvent(event);
    } catch (error) {
      this.logger?.warn(`lid-pause: event handler failed: ${error.message}`);
    }
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer);
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    this.restartTimer = undefined;
    this.watchdog = undefined;
    const child = this.child;
    this.child = undefined;
    if (child !== undefined) {
      child.stdin?.end?.();
      child.kill?.('SIGTERM');
    }
  }
}
