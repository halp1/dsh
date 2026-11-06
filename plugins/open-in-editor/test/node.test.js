import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorArgs, parseOpenBody, resolveConfig, resolveEditor, DEFAULT_SIDEBAR_EXTENSIONS } from '../src/index.js';

test('config defaults and validation', () => {
  const c = resolveConfig(undefined);
  assert.deepEqual(c.sidebarExtensions, [...DEFAULT_SIDEBAR_EXTENSIONS]);
  assert.equal(c.localOnly, true);
  assert.deepEqual(resolveConfig({ sidebarExtensions: ['.MD'] }).sidebarExtensions, ['md']);
  assert.throws(() => resolveConfig({ command: '' }), /command/);
  assert.throws(() => resolveConfig({ localOnly: 'no' }), /localOnly/);
});

test('editor argv', () => {
  assert.deepEqual(editorArgs({ path: '/w/a.ts', line: 4, workspace: '/w' }, true), ['/w', '-g', '/w/a.ts:4']);
  assert.deepEqual(editorArgs({ path: '/x/a.ts', workspace: '/w' }, true), ['-g', '/x/a.ts:1']);
  assert.deepEqual(editorArgs({ path: '/w/a.ts', workspace: '/w' }, false), ['-g', '/w/a.ts:1']);
  assert.deepEqual(editorArgs({ path: '/w2/a.ts', workspace: '/w' }, true), ['-g', '/w2/a.ts:1']);
});

test('open body validation', () => {
  assert.deepEqual(parseOpenBody('{"path":"/a.ts","line":2,"workspace":"/w"}'), { path: '/a.ts', line: 2, workspace: '/w' });
  assert.match(parseOpenBody('{"path":"a.ts"}'), /absolute/);
  assert.match(parseOpenBody('{"path":"/a.ts","line":0}'), /line/);
  assert.match(parseOpenBody('nope'), /JSON/);
});

test('resolveEditor finds executables on PATH and by absolute path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oie-'));
  const bin = join(dir, 'code');
  await writeFile(bin, '#!/bin/sh\n');
  await chmod(bin, 0o755);
  assert.equal(await resolveEditor(['missing', 'code'], dir), bin);
  assert.equal(await resolveEditor([bin], ''), bin);
  assert.equal(await resolveEditor(['missing'], dir), undefined);
});
