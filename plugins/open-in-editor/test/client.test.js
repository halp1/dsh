import { test } from 'node:test';
import strict from 'node:assert/strict';
const assert = { ...strict, deepEqual: (a, b, m) => strict.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m) };
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = readFileSync(fileURLToPath(new URL('../src/client.js', import.meta.url)), 'utf8');
function loadClient() {
  let registration;
  vm.runInNewContext(SOURCE, { window: { __ModuleLoader__: { load: (r) => { registration = r; } } } });
  assert.equal(registration.id, 'dsh-plugin-open-in-editor');
  return registration.factory(() => { throw new Error('no require'); });
}
const client = loadClient();
const SIDEBAR = new Set(['md', 'png']);
const addr = (path, sid = 's1') => `dsh-resource://file/session/${sid}/${path.split('/').map(encodeURIComponent).join('/')}`;
const plain = (v) => JSON.parse(JSON.stringify(v));
const tick = () => new Promise(r => setTimeout(r, 0));

test('parses session file addresses', () => {
  assert.deepEqual(client.parseSessionFile(addr('src/a b.ts')), { sessionId: 's1', path: 'src/a b.ts' });
  assert.deepEqual(client.parseSessionFile('dsh-resource://file/session/s1//Users/x/a.ts'), { sessionId: 's1', path: '/Users/x/a.ts' });
  assert.equal(client.parseSessionFile('dsh-resource://plan/x'), undefined);
  assert.equal(client.parseSessionFile('dsh-resource://file/absolute/Users/x'), undefined);
});

test('extension and absolute path helpers', () => {
  assert.equal(client.extensionOf('a/README.MD'), 'md');
  assert.equal(client.extensionOf('a/.gitignore'), '');
  assert.equal(client.extensionOf('Makefile'), '');
  assert.equal(client.absolutePathOf('/w/', 'src/a.ts'), '/w/src/a.ts');
  assert.equal(client.absolutePathOf('/w', '/abs/a.ts'), '/abs/a.ts');
  assert.equal(client.absolutePathOf(undefined, 'a.ts'), undefined);
  assert.equal(client.absolutePathOf('C:\\w', 'src/a.ts'), 'C:\\w\\src\\a.ts');
});

test('editorTarget routes code, keeps markdown in the sidebar', () => {
  const cwdOf = () => '/w';
  assert.deepEqual(client.editorTarget({ address: addr('src/a.ts'), options: { params: { line: 12 } }, cwdOf, sidebarExtensions: SIDEBAR }),
    { path: '/w/src/a.ts', line: 12, workspace: '/w' });
  assert.equal(client.editorTarget({ address: addr('docs/x.md'), cwdOf, sidebarExtensions: SIDEBAR }), undefined);
  assert.equal(client.editorTarget({ address: addr('img.PNG'), cwdOf, sidebarExtensions: SIDEBAR }), undefined);
  assert.deepEqual(client.editorTarget({ address: addr('Makefile'), cwdOf, sidebarExtensions: SIDEBAR }), { path: '/w/Makefile', workspace: '/w' });
});

function fakeSidebar() {
  const calls = [];
  return { calls, sidebar: { openResource(address, options) { calls.push([address, options]); } } };
}
const available = async () => ({ available: true, sidebarExtensions: SIDEBAR, localOnly: true });

test('install: code goes to the editor, markdown and other kinds to the sidebar', async () => {
  const { calls, sidebar } = fakeSidebar();
  const opened = [];
  const dispose = client.install(sidebar, { cwdOf: () => '/w', config: available, open: async t => { opened.push(t); return true; }, isLocal: () => true });
  sidebar.openResource(addr('a.ts'), { params: { line: 3 } });
  sidebar.openResource(addr('b.md'));
  sidebar.openResource('dsh-resource://plan/p1');
  await tick();
  assert.deepEqual(opened, [{ path: '/w/a.ts', line: 3, workspace: '/w' }]);
  assert.deepEqual(calls.map(c => c[0]), ['dsh-resource://plan/p1', addr('b.md')]);
  dispose();
  assert.equal(Object.hasOwn(sidebar, 'openResource'), true, 'own method restored');
  sidebar.openResource(addr('c.ts'));
  assert.equal(calls.at(-1)[0], addr('c.ts'));
});

test('install: failures and remote pages fall back to the sidebar', async () => {
  for (const deps of [
    { open: async () => false, isLocal: () => true },
    { open: async () => { throw new Error('net'); }, isLocal: () => true },
    { open: async () => true, isLocal: () => false },
    { open: async () => true, isLocal: () => true, config: async () => ({ available: false, sidebarExtensions: SIDEBAR, localOnly: true }) },
    { open: async () => true, isLocal: () => true, config: async () => undefined },
  ]) {
    const { calls, sidebar } = fakeSidebar();
    client.install(sidebar, { cwdOf: () => '/w', config: available, onError: () => {}, ...deps });
    sidebar.openResource(addr('a.ts'), { params: { line: 1 } });
    await tick();
    assert.deepEqual(calls, [[addr('a.ts'), { params: { line: 1 } }]]);
  }
});

test('install on a prototype method restores by deleting the shadow', () => {
  class Controller { openResource() { return 'proto'; } }
  const sidebar = new Controller();
  const dispose = client.install(sidebar, { cwdOf: () => '/w', config: available, open: async () => true });
  assert.equal(Object.hasOwn(sidebar, 'openResource'), true);
  dispose();
  assert.equal(Object.hasOwn(sidebar, 'openResource'), false);
  assert.equal(sidebar.openResource(), 'proto');
});
