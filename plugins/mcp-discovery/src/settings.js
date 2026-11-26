import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveConfig } from './config.js';

export const SETTINGS_API_PATH = '/api/dsh-mcp-discovery.settings';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export class SettingsConflictError extends Error {}
export class SettingsValidationError extends Error {}

export function defaultSettingsFilePath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugins', 'mcp-discovery', 'settings.json');
}

function normalize(settings) {
  if (!record(settings) || Object.hasOwn(settings, 'settingsFile')) throw new SettingsValidationError('Expected discovery settings without a file path.');
  try { return resolveConfig(settings); }
  catch (error) { throw new SettingsValidationError(error.message); }
}

/** A private atomic file with revision checks, shared by every settings connection. */
export class SettingsStore {
  constructor(filePath, initial) {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new SettingsValidationError('settingsFile must be a nonempty path.');
    this.filePath = resolve(filePath);
    this.initial = normalize(initial);
    this.current = { settings: this.initial, revision: 0 };
    this.refresh();
  }
  refresh() {
    let text;
    try { text = readFileSync(this.filePath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return this.current;
      throw new Error('Cannot read Tool Discovery settings.');
    }
    try {
      const body = JSON.parse(text);
      if (!record(body) || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error();
      this.current = { settings: normalize(body.settings), revision: body.revision };
    } catch { throw new Error('Tool Discovery settings are invalid. Repair the saved file before continuing.'); }
    return this.current;
  }
  snapshot() { return structuredClone(this.refresh()); }
  save(settings, expectedRevision) {
    const normalized = normalize(settings);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new SettingsValidationError('A settings revision is required.');
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lock = `${this.filePath}.lock`;
    let lockFd;
    try { lockFd = openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new SettingsConflictError('Settings are being saved elsewhere. Reload and try again.');
      throw error;
    }
    const temporary = join(directory, `.mcp-discovery-${randomUUID()}.tmp`);
    let fd;
    let created = false;
    try {
      const current = this.refresh();
      if (current.revision !== expectedRevision) throw new SettingsConflictError('Settings changed elsewhere. Reload before saving.');
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new SettingsValidationError('Settings revision limit reached.');
      const next = { settings: normalized, revision: current.revision + 1 };
      fd = openSync(temporary, 'wx', 0o600);
      created = true;
      writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      // Both paths are absolute and the exclusively owned temporary is in the target directory.
      if (dirname(temporary) !== directory || dirname(this.filePath) !== directory) throw new Error('Invalid settings destination.');
      renameSync(temporary, this.filePath);
      created = false;
      this.current = next;
      return structuredClone(next);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (created && dirname(temporary) === directory) unlinkSync(temporary);
      closeSync(lockFd);
      // This exact absolute lock was exclusively created by this save operation.
      if (lock === `${this.filePath}.lock` && dirname(lock) === directory) unlinkSync(lock);
    }
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Only mount via connection.fetch so host authentication and trust checks run first. */
export function settingsHandler(store, discovery, tools) {
  const snapshot = () => {
    const saved = store.snapshot();
    discovery.updateConfig(saved.settings);
    return {
      ...saved,
      tools: tools.schemas().map(({ name, description }) => ({ name, description: String(description ?? '').replace(/\s+/gu, ' ').slice(0, 240) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  };
  return async (request) => {
    if (request.method === 'GET') {
      try { return json(snapshot()); }
      catch { return json({ error: 'Could not load Tool Discovery settings.' }, 500); }
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') ?? '')) return json({ error: 'Expected application/json.' }, 415);
    let body;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text) > 65_536) return json({ error: 'Settings payload is too large.' }, 413);
      body = JSON.parse(text);
    } catch { return json({ error: 'Expected valid JSON.' }, 400); }
    if (!record(body) || Object.keys(body).some((key) => !['settings', 'revision'].includes(key)) || !record(body.settings) ||
        !['servers', 'maxSelectedTools', 'prefixes', 'tools'].every((key) => Object.hasOwn(body.settings, key))) {
      return json({ error: 'Expected a complete settings object and revision.' }, 400);
    }
    try {
      const saved = store.save(body.settings, body.revision);
      discovery.updateConfig(saved.settings);
      return json({ ...saved, tools: snapshot().tools });
    } catch (error) {
      if (error instanceof SettingsConflictError) return json({ error: error.message }, 409);
      if (error instanceof SettingsValidationError) return json({ error: error.message }, 400);
      return json({ error: 'Could not persist Tool Discovery settings.' }, 500);
    }
  };
}

export function registerSettings(ctx, discovery, rawConfig = {}) {
  let store;
  const initialize = () => {
    if (!store) {
      store = new SettingsStore(rawConfig.settingsFile ?? defaultSettingsFilePath(), discovery.config);
      discovery.updateConfig(store.snapshot().settings);
    }
    return store;
  };
  // Headless test fixtures do not read a real profile unless a file was requested.
  if (rawConfig.settingsFile !== undefined) initialize();
  ctx.inject(['connection'], (connCtx) => {
    const connection = connCtx.get('connection');
    const settings = initialize();
    connCtx.effect(() => connection.fetch.register({
      path: SETTINGS_API_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
      fetch: settingsHandler(settings, discovery, ctx.tools),
    }));
  });
}
