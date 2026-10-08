/**
 * Page runtime behaviour against a minimal fake DOM. The runtime is also
 * exercised in its serialized form (the exact text shipped in the index) to
 * prove it has no hidden dependency on module scope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installWcoRuntime, pageScriptText } from '../src/page.js';

// ── tiny DOM ───────────────────────────────────────────────────────────────
class El {
  constructor(tag) {
    this.nodeName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.textContent = '';
    const props = {};
    this.style = {
      cssText: '',
      setProperty: (k, v) => { props[k] = v; },
      removeProperty: (k) => { delete props[k]; },
      getPropertyValue: (k) => props[k] ?? '',
      _props: props,
    };
  }
  get id() { return this.attrs.id ?? ''; }
  set id(v) { this.attrs.id = v; }
  get name() { return this.attrs.name ?? ''; }
  set name(v) { this.attrs.name = v; }
  get content() { return this.attrs.content ?? ''; }
  set content(v) { this.attrs.content = v; }
  get firstChild() { return this.children[0] ?? null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parent) c.remove();
    const i = ref === null ? this.children.length : this.children.indexOf(ref);
    this.children.splice(i < 0 ? this.children.length : i, 0, c);
    c.parent = this;
    return c;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  *walk() { yield this; for (const c of this.children) yield* c.walk(); }
}

function makeWindow({ overlay, width = 1200, sheets = [], storage = {}, rootAttrs = {} } = {}) {
  const html = new El('html');
  const head = html.appendChild(new El('head'));
  const body = html.appendChild(new El('body'));
  Object.assign(html.attrs, rootAttrs);
  const doc = {
    documentElement: html,
    head,
    body,
    readyState: 'complete',
    styleSheets: sheets,
    createElement: (t) => new El(t),
    getElementById: (id) => { for (const n of html.walk()) if (n.id === id) return n; return null; },
    addEventListener() {},
  };
  const winListeners = {};
  const raf = [];
  const win = {
    document: doc,
    innerWidth: width,
    navigator: overlay ? { windowControlsOverlay: overlay } : {},
    location: { search: '' },
    localStorage: {
      getItem: (k) => storage[k] ?? null,
      setItem: (k, v) => { storage[k] = v; },
    },
    getComputedStyle: (el) => ({
      backgroundColor: el.style.cssText.includes('sidebar-fill') ? 'rgb(240, 241, 245)' : 'rgb(255, 255, 255)',
      getPropertyValue: () => '',
    }),
    requestAnimationFrame: (f) => { raf.push(f); return raf.length; },
    addEventListener: (t, f) => { (winListeners[t] ??= []).push(f); },
    removeEventListener: (t, f) => { winListeners[t] = (winListeners[t] ?? []).filter((x) => x !== f); },
    flush() { while (raf.length) raf.shift()(); },
    fire(t) { for (const f of winListeners[t] ?? []) f(); },
    storage,
  };
  return win;
}

function fakeOverlay(rect, visible = true) {
  const listeners = new Set();
  return {
    visible,
    rect,
    getTitlebarAreaRect() { return this.rect; },
    addEventListener: (t, f) => listeners.add(f),
    removeEventListener: (t, f) => listeners.delete(f),
    set(rect, vis = true) { this.rect = rect; this.visible = vis; for (const f of listeners) f(); },
    listeners,
  };
}

function rule(selectorText, props) {
  return {
    selectorText,
    style: { getPropertyValue: (k) => props[k] ?? '' },
  };
}

const WIN_RECT = { x: 0, y: 0, width: 1060, height: 33 };   // controls on the right
const MAC_RECT = { x: 78, y: 0, width: 1078, height: 32 };  // traffic lights on the left

// ── tests ──────────────────────────────────────────────────────────────────
test('no overlay API: page is left untouched', () => {
  const win = makeWindow();
  const h = installWcoRuntime(win);
  const root = win.document.documentElement;
  assert.equal(root.hasAttribute('data-windows-titlebar'), false);
  assert.equal(root.hasAttribute('data-dsh-wco'), false);
  assert.equal(h.state().active, false);
  assert.equal(h.state().supported, false);
});

test('hidden overlay (tab, or overlay toggled off) is not applied', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT, false) });
  const h = installWcoRuntime(win);
  assert.equal(h.state().active, false);
  assert.equal(h.state().supported, true);
  assert.equal(win.document.documentElement.hasAttribute('data-windows-titlebar'), false);
});

test('visible overlay with controls on the right reuses the Windows titlebar contract', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  const h = installWcoRuntime(win);
  const root = win.document.documentElement;
  assert.equal(root.getAttribute('data-dsh-wco'), 'right');
  assert.equal(root.hasAttribute('data-windows-titlebar'), true);
  assert.equal(root.style.getPropertyValue('--dsh-windows-titlebar-height'), '33px');
  assert.equal(root.style.getPropertyValue('--dsh-wco-inset-right'), '140px');
  assert.equal(root.style.getPropertyValue('--dsh-wco-inset-left'), '0px');
  assert.deepEqual(h.state().geometry, { height: 33, left: 0, right: 140, side: 'right' });
});

test('controls on the left (macOS) are detected from the rect', () => {
  const win = makeWindow({ overlay: fakeOverlay(MAC_RECT) });
  const h = installWcoRuntime(win);
  assert.equal(h.state().geometry.side, 'left');
  assert.equal(win.document.documentElement.style.getPropertyValue('--dsh-wco-inset-left'), '78px');
});

test('geometrychange re-measures and hiding the overlay withdraws every mark', () => {
  const overlay = fakeOverlay(WIN_RECT);
  const win = makeWindow({ overlay });
  installWcoRuntime(win);
  const root = win.document.documentElement;
  overlay.set({ x: 0, y: 0, width: 1000, height: 40 });
  assert.equal(root.style.getPropertyValue('--dsh-windows-titlebar-height'), '40px');
  overlay.set(WIN_RECT, false);
  assert.equal(root.hasAttribute('data-windows-titlebar'), false);
  assert.equal(root.hasAttribute('data-dsh-wco'), false);
  assert.equal(root.style.getPropertyValue('--dsh-windows-titlebar-height'), '');
  assert.equal(win.document.getElementById('dsh-wco-theme-color'), null);
});

test('a desktop shell that owns its chrome is never overridden', () => {
  for (const rootAttrs of [{ 'data-platform': 'darwin' }, { 'data-windows-titlebar': '' }]) {
    const win = makeWindow({ overlay: fakeOverlay(WIN_RECT), rootAttrs });
    const h = installWcoRuntime(win);
    assert.equal(h.state().active, false);
    assert.equal(h.state().foreignShell, true);
    assert.equal(win.document.documentElement.hasAttribute('data-dsh-wco'), false);
  }
  const stamped = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  stamped.location.search = '?dsh-desktop-mode=advanced';
  assert.equal(installWcoRuntime(stamped).state().active, false);
});

test('theme-color meta is placed first in head and follows the band fill', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  const presenterMeta = win.document.head.appendChild(new El('meta'));
  presenterMeta.name = 'theme-color';
  presenterMeta.content = 'rgb(255, 255, 255)';
  installWcoRuntime(win);
  const ours = win.document.getElementById('dsh-wco-theme-color');
  assert.ok(ours);
  assert.equal(win.document.head.firstChild, ours);
  assert.equal(ours.name, 'theme-color');
  assert.equal(ours.content, 'rgb(240, 241, 245)');
});

test('themeColor: false leaves theme-color alone', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  installWcoRuntime(win, { themeColor: false });
  assert.equal(win.document.getElementById('dsh-wco-theme-color'), null);
});

test('left-side controls shift fixed caption rules by the left inset', () => {
  const sheets = [{
    ownerNode: null,
    cssRules: [
      rule('[data-windows-titlebar] .x_toggle', { position: 'fixed', left: '12px', top: 'calc(1px)' }),
      rule('[data-windows-titlebar] .x_collapsed .x_newSession', { position: 'fixed', left: '48px' }),
      rule('[data-windows-titlebar] .x_brand', { 'padding-left': '4px' }),        // not fixed
      rule('.x_toggle', { position: 'fixed', left: '0' }),                        // not caption-scoped
      { cssRules: [rule('[data-windows-titlebar] .x_media', { position: 'fixed', left: '5px' })] }, // @media
    ],
  }, {
    get cssRules() { throw new Error('cross-origin'); },
  }];
  const win = makeWindow({ overlay: fakeOverlay(MAC_RECT), sheets });
  installWcoRuntime(win);
  win.flush();
  const el = win.document.getElementById('dsh-wco-shift');
  assert.ok(el, 'shift stylesheet installed');
  const lines = el.textContent.split('\n');
  assert.deepEqual(lines, [
    'html[data-dsh-wco="left"] :is([data-windows-titlebar] .x_toggle){left:calc(12px + var(--dsh-wco-inset-left, 0px))}',
    'html[data-dsh-wco="left"] :is([data-windows-titlebar] .x_collapsed .x_newSession){left:calc(48px + var(--dsh-wco-inset-left, 0px))}',
    'html[data-dsh-wco="left"] :is([data-windows-titlebar] .x_media){left:calc(5px + var(--dsh-wco-inset-left, 0px))}',
  ]);
});

test('right-side controls install no shift stylesheet', () => {
  const sheets = [{ cssRules: [rule('[data-windows-titlebar] .t', { position: 'fixed', left: '12px' })] }];
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT), sheets });
  installWcoRuntime(win);
  win.flush();
  assert.equal(win.document.getElementById('dsh-wco-shift'), null);
});

test('configure({enabled:false}) persists and withdraws; simulate fakes an overlay', () => {
  const win = makeWindow();
  const h = installWcoRuntime(win);
  let s = h.configure({ simulate: 'left' });
  assert.equal(s.active, true);
  assert.equal(s.geometry.side, 'left');
  assert.ok(win.document.getElementById('dsh-wco-mock'), 'simulation draws a mock controls area');
  s = h.configure({ enabled: false });
  assert.equal(s.active, false);
  assert.equal(win.document.getElementById('dsh-wco-mock'), null);
  assert.deepEqual(JSON.parse(win.storage['dsh.wco.settings']), { enabled: false, simulate: 'left' });

  // A fresh page load reads the persisted settings.
  const again = installWcoRuntime(makeWindow({ storage: win.storage }));
  assert.equal(again.state().active, false);
  assert.equal(again.state().settings.enabled, false);
});

test('dispose removes marks, nodes, listeners and the global handle', () => {
  const overlay = fakeOverlay(WIN_RECT);
  const win = makeWindow({ overlay });
  const h = installWcoRuntime(win);
  assert.equal(win.__dshWco__, h);
  h.dispose();
  assert.equal(win.document.documentElement.hasAttribute('data-windows-titlebar'), false);
  assert.equal(win.document.getElementById('dsh-wco-theme-color'), null);
  assert.equal(overlay.listeners.size, 0);
  assert.equal(win.__dshWco__, undefined);
});

test('a throwing overlay API never breaks the page', () => {
  const overlay = { visible: true, getTitlebarAreaRect() { throw new Error('boom'); }, addEventListener() {} };
  const win = makeWindow({ overlay });
  assert.equal(installWcoRuntime(win).state().active, false);
});

test('serialized script runs standalone and installs the handle', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  const text = pageScriptText();
  new Function('window', 'console', text)(win, console);
  assert.equal(typeof win.__dshWco__?.state, 'function');
  assert.equal(win.__dshWco__.state().active, true);
});
