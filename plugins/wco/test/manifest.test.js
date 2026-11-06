import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FALLBACK_BASE_MANIFEST,
  createManifestHandler,
  locateBaseManifest,
  patchManifest,
  readBaseManifest,
} from '../src/manifest.js';

function fakeRes() {
  return {
    status: 0,
    headers: {},
    body: undefined,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

test('patchManifest puts the configured chain first and keeps display', () => {
  const out = patchManifest(
    { name: 'X', display: 'fullscreen', display_override: ['standalone', 'tabbed'] },
    { displayOverride: ['window-controls-overlay', 'standalone'] },
  );
  assert.deepEqual(out.display_override, ['window-controls-overlay', 'standalone', 'tabbed']);
  assert.equal(out.display, 'fullscreen');
  assert.equal(out.name, 'X');
});

test('patchManifest applies field overrides last', () => {
  const out = patchManifest({ name: 'X', theme_color: '#fff' }, {
    displayOverride: ['window-controls-overlay'],
    manifest: { theme_color: '#000', display_override: ['standalone'] },
  });
  assert.equal(out.theme_color, '#000');
  assert.deepEqual(out.display_override, ['standalone']);
});

test('readBaseManifest falls back on missing or corrupt input', async () => {
  assert.deepEqual(await readBaseManifest(undefined), FALLBACK_BASE_MANIFEST);
  assert.deepEqual(await readBaseManifest('/nonexistent/manifest.webmanifest'), FALLBACK_BASE_MANIFEST);
  const dir = await mkdtemp(join(tmpdir(), 'wco-'));
  const bad = join(dir, 'bad.webmanifest');
  await writeFile(bad, '{ nope');
  assert.deepEqual(await readBaseManifest(bad), FALLBACK_BASE_MANIFEST);
  const arr = join(dir, 'arr.webmanifest');
  await writeFile(arr, '[]');
  assert.deepEqual(await readBaseManifest(arr), FALLBACK_BASE_MANIFEST);
});

test('handler serves the patched manifest from disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wco-'));
  const path = join(dir, 'manifest.webmanifest');
  await writeFile(path, JSON.stringify({ name: 'Shell', display: 'fullscreen' }));
  const handler = createManifestHandler({ basePath: path, displayOverride: ['window-controls-overlay'] });
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/manifest+json');
  assert.deepEqual(JSON.parse(res.body), {
    name: 'Shell',
    display: 'fullscreen',
    display_override: ['window-controls-overlay'],
  });
});

test('handler answers HEAD without a body and rejects other methods', async () => {
  const handler = createManifestHandler({ basePath: undefined, displayOverride: ['standalone'] });
  const head = fakeRes();
  await handler({ method: 'HEAD' }, head);
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  const post = fakeRes();
  await handler({ method: 'POST' }, post);
  assert.equal(post.status, 405);
});

test('locateBaseManifest honours an explicit path', () => {
  assert.equal(locateBaseManifest('/x/m.webmanifest'), '/x/m.webmanifest');
});

test('locateBaseManifest finds the real shell manifest when dsh is installed', (t) => {
  const found = locateBaseManifest(undefined);
  if (found === undefined) {
    t.skip('dsh web frontend not resolvable from this machine');
    return;
  }
  assert.match(found, /dsh-web-frontend[\\/]dist[\\/]manifest\.webmanifest$/);
});
