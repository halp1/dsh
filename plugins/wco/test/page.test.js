/**
 * Page runtime behaviour. The avoidance planner is pure and tested with
 * measurements taken from the real DSH header (Chrome, 1500px wide); the DOM
 * glue runs against a minimal fake DOM. The runtime is also exercised in its
 * serialized form (the exact text shipped in the index) to prove it has no
 * hidden dependency on module scope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installWcoRuntime, pageScriptText } from '../src/page.js';

// ── tiny DOM ───────────────────────────────────────────────────────────────
class El {
  constructor(tag, rect) {
    this.nodeName = tag.toUpperCase();
    this.nodeType = 1;
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.rect = rect ?? { left: 0, right: 0, top: 0, bottom: 0 };
    this.computed = {};
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
  get className() { return this.attrs.class ?? ''; }
  get firstChild() { return this.children[0] ?? null; }
  get childElementCount() { return this.children.length; }
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
  contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }
  getBoundingClientRect() { return this.rect; }
  /** Supports the runtime's selectors: [data-window-drag], header, class-substring. */
  matches(sel) {
    return sel.split(',').some((s) => {
      s = s.trim();
      if (s === 'header') return this.nodeName === 'HEADER';
      let m = /^\[([\w-]+)\]$/.exec(s);
      if (m) return this.hasAttribute(m[1]);
      m = /^\[class\*="([^"]+)"\]$/.exec(s);
      if (m) return this.className.includes(m[1]);
      return false;
    });
  }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) {
    if (sel === '*') return [...this.walk()];
    return [...this.walk()].filter((n) => n.matches(sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  closest(sel) { for (let n = this; n; n = n.parent) if (n.matches && n.matches(sel)) return n; return null; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html ?? ''; }
}

function makeWindow({ overlay, width = 1500, storage = {}, rootAttrs = {} } = {}) {
  const html = new El('html');
  const head = html.appendChild(new El('head'));
  const body = html.appendChild(new El('body'));
  Object.assign(html.attrs, rootAttrs);
  const doc = {
    documentElement: html,
    head,
    body,
    readyState: 'complete',
    createElement: (t) => new El(t),
    getElementById: (id) => { if (html.id === id) return html; for (const n of html.walk()) if (n.id === id) return n; return null; },
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {},
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
      backgroundColor: el.style.cssText.includes('--dsw-alias-bg-base') ? 'rgb(21, 21, 23)' : 'rgba(0, 0, 0, 0)',
      paddingLeft: el.computed.paddingLeft ?? '0px',
      paddingRight: el.computed.paddingRight ?? '0px',
      marginTop: el.computed.marginTop ?? '0px',
      getPropertyValue: () => '',
    }),
    requestAnimationFrame: (f) => { raf.push(f); return raf.length; },
    addEventListener: (t, f) => { (winListeners[t] ??= []).push(f); },
    removeEventListener: (t, f) => { winListeners[t] = (winListeners[t] ?? []).filter((x) => x !== f); },
    flush() { while (raf.length) raf.shift()(); },
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

const WIN_RECT = { x: 0, y: 0, width: 1316, height: 33 };   // controls on the right (1500 wide)
const MAC_RECT = { x: 85, y: 0, width: 1299, height: 38 };  // traffic lights left, app menu right

const R = (left, right, top, bottom) => ({ left, right, top, bottom });

// Rows measured from the real DSH page at 1500px, sidebar expanded.
const logoRow = () => ({ rect: R(12, 268, 6, 66), padL: 4, padR: 0, marginTop: 0,
  leaves: [R(16, 232, 24, 48), R(240, 268, 22, 50)] });
const header = () => ({ rect: R(280, 1500, 0, 76), padL: 20, padR: 28, marginTop: 0,
  leaves: [R(300, 536, 7, 35), R(1338, 1379, 10, 32), R(1388, 1416, 7, 35), R(1460, 1488, 7, 35), R(308, 337, 50, 75)] });
const tabStrip = () => ({ rect: R(1500, 2175, 0, 33), padL: 10, padR: 6, marginTop: 0,
  leaves: [R(1514, 1542, 5, 33), R(2069, 2097, 5, 33)] });
const rail = () => ({ rect: R(10, 45, 18, 54), padL: 0, padR: 0, marginTop: 0, leaves: [R(10, 46, 18, 54)] });

function boxesFor(geo) {
  return installWcoRuntime(makeWindow()).controlBoxes(geo);
}
const MAC = { height: 38, left: 85, right: 116, width: 1500 };
const WIN = { height: 33, left: 0, right: 184, width: 1500 };

// ── planner ────────────────────────────────────────────────────────────────
test('plan: macOS — sidebar brand moves beside the traffic lights, header clears the right controls', () => {
  const h = installWcoRuntime(makeWindow());
  const out = h.plan([logoRow(), header(), tabStrip()], boxesFor(MAC));
  assert.deepEqual(out, [
    { index: 0, paddingLeft: 81, marginTop: -17 },   // 85 + 8 - 16 + 4; lifted to centre in the strip
    { index: 1, paddingRight: 140 },                 // 1488 - (1384 - 8) + 28
  ]);
});

test('plan: Windows — only the header yields, nothing on the left moves', () => {
  const h = installWcoRuntime(makeWindow());
  // Header as measured under a 33px strip: title row centred at 2–32.
  const winHeader = { rect: R(280, 1500, 0, 72), padL: 20, padR: 28, marginTop: 0,
    leaves: [R(300, 536, 2, 32), R(1388, 1416, 3, 31), R(1460, 1488, 3, 31)] };
  // 1488 - (1316 - 8) + 28; already centred, so no vertical change.
  assert.deepEqual(h.plan([logoRow(), winHeader], boxesFor(WIN)), [{ index: 1, paddingRight: 208 }]);
});

test('plan: a row too narrow to shift sideways moves down under the controls', () => {
  const h = installWcoRuntime(makeWindow());
  assert.deepEqual(h.plan([rail()], boxesFor(MAC)), [{ index: 0, marginTop: 24 }]); // 38 + 4 - 18
});

test('plan: rows already clear are untouched, and content below the strip never counts', () => {
  const h = installWcoRuntime(makeWindow());
  const low = { rect: R(0, 400, 0, 100), padL: 0, padR: 0, marginTop: 0, leaves: [R(0, 60, 50, 80)] };
  const clear = { rect: R(300, 900, 0, 40), padL: 0, padR: 0, marginTop: 0, leaves: [R(300, 400, 8, 32)] };
  assert.deepEqual(h.plan([low, clear], boxesFor(MAC)), []);
});

test('plan: each row is decided independently (no state leaks between rows)', () => {
  const h = installWcoRuntime(makeWindow());
  const out = h.plan([logoRow(), tabStrip(), tabStrip()], boxesFor(MAC));
  assert.equal(out.length, 1);
  assert.equal(out[0].index, 0);
});

test('controlBoxes reflect each side that has controls', () => {
  assert.deepEqual(boxesFor(MAC).map((b) => [b.side, b.left, b.right, b.bottom]), [['left', 0, 85, 38], ['right', 1384, 1500, 38]]);
  assert.deepEqual(boxesFor(WIN).map((b) => b.side), ['right']);
});

// ── runtime ────────────────────────────────────────────────────────────────
test('no overlay API: page is left untouched', () => {
  const win = makeWindow();
  const h = installWcoRuntime(win);
  assert.equal(win.document.documentElement.hasAttribute('data-dsh-wco'), false);
  assert.equal(win.document.getElementById('dsh-wco-drag'), null);
  assert.equal(h.state().active, false);
  assert.equal(h.state().supported, false);
});

test('hidden overlay (tab, or title bar shown) is not applied', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT, false) });
  const h = installWcoRuntime(win);
  assert.equal(h.state().active, false);
  assert.equal(h.state().supported, true);
});

test('visible overlay marks the document and installs a drag strip — without reserving space', () => {
  const win = makeWindow({ overlay: fakeOverlay(MAC_RECT) });
  const h = installWcoRuntime(win);
  const root = win.document.documentElement;
  assert.equal(root.getAttribute('data-dsh-wco'), 'left right');
  assert.equal(root.hasAttribute('data-windows-titlebar'), false, 'must not push the frame down');
  assert.equal(root.style.getPropertyValue('--dsh-wco-height'), '38px');
  assert.equal(root.style.getPropertyValue('--dsh-wco-inset-left'), '85px');
  assert.equal(root.style.getPropertyValue('--dsh-wco-inset-right'), '116px');
  const strip = win.document.getElementById('dsh-wco-drag');
  assert.ok(strip);
  assert.equal(win.document.body.firstChild, strip);
  assert.match(strip.style.cssText, /app-region:drag/);
  assert.match(strip.style.cssText, /pointer-events:none/);
  assert.deepEqual(h.state().geometry, MAC);
});

test('avoidance pass applies the plan to real elements and undoes it when the overlay hides', () => {
  const overlay = fakeOverlay(MAC_RECT);
  const win = makeWindow({ overlay });
  const sidebar = win.document.body.appendChild(new El('div', R(0, 280, 0, 900)));
  const row = sidebar.appendChild(new El('div', R(12, 268, 6, 66)));
  row.setAttribute('data-window-drag', '');
  row.computed.paddingLeft = '4px';
  row.appendChild(new El('span', R(16, 232, 24, 48)));
  row.appendChild(new El('button', R(240, 268, 22, 50)));
  installWcoRuntime(win);
  win.flush();
  assert.equal(row.style.getPropertyValue('padding-left'), '81px');
  assert.equal(row.style.getPropertyValue('margin-top'), '-17px');
  assert.ok(row.hasAttribute('data-dsh-wco-adjusted'));
  overlay.set(MAC_RECT, false);
  win.flush();
  assert.equal(row.style.getPropertyValue('padding-left'), '');
  assert.equal(row.style.getPropertyValue('margin-top'), '');
  assert.equal(row.hasAttribute('data-dsh-wco-adjusted'), false);
  assert.equal(win.document.documentElement.hasAttribute('data-dsh-wco'), false);
  assert.equal(win.document.getElementById('dsh-wco-drag'), null);
});

test('repeated passes are stable (no compounding offsets)', () => {
  const win = makeWindow({ overlay: fakeOverlay(MAC_RECT) });
  const row = win.document.body.appendChild(new El('div', R(12, 268, 6, 66)));
  row.setAttribute('data-window-drag', '');
  row.appendChild(new El('span', R(16, 232, 24, 48)));
  const h = installWcoRuntime(win);
  win.flush();
  const first = row.style.getPropertyValue('padding-left');
  h.refresh(); h.refresh();
  assert.equal(row.style.getPropertyValue('padding-left'), first);
});

test('a desktop shell that owns its chrome is never overridden', () => {
  for (const rootAttrs of [{ 'data-platform': 'darwin' }, { 'data-windows-titlebar': '' }]) {
    const win = makeWindow({ overlay: fakeOverlay(WIN_RECT), rootAttrs });
    const h = installWcoRuntime(win);
    assert.equal(h.state().active, false);
    assert.equal(h.state().foreignShell, true);
  }
  const stamped = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  stamped.location.search = '?dsh-desktop-mode=advanced';
  assert.equal(installWcoRuntime(stamped).state().active, false);
});

test('theme-color meta goes first in head with the opaque content background', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  const presenterMeta = win.document.head.appendChild(new El('meta'));
  presenterMeta.name = 'theme-color';
  presenterMeta.content = 'rgb(1, 2, 3)';
  installWcoRuntime(win);
  const ours = win.document.getElementById('dsh-wco-theme-color');
  assert.ok(ours);
  assert.equal(win.document.head.firstChild, ours);
  assert.equal(ours.content, 'rgb(21, 21, 23)');
});

test('translucent themes are composited to an opaque theme-color', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  win.document.body.setAttribute('data-ds-dark-theme', '');
  const base = win.getComputedStyle;
  win.getComputedStyle = (el) => ({ ...base(el), backgroundColor: el.style.cssText.includes('--dsw-alias-bg-base') ? 'rgba(200, 100, 50, 0.5)' : 'rgba(0, 0, 0, 0)' });
  installWcoRuntime(win);
  assert.equal(win.document.getElementById('dsh-wco-theme-color').content, 'rgb(100, 50, 25)');
});

test('themeColor: false leaves theme-color alone', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  installWcoRuntime(win, { themeColor: false });
  assert.equal(win.document.getElementById('dsh-wco-theme-color'), null);
});

test('configure: simulate fakes an overlay; enabled:false persists and withdraws', () => {
  const win = makeWindow();
  const h = installWcoRuntime(win);
  let s = h.configure({ simulate: 'mac' });
  assert.equal(s.active, true);
  assert.deepEqual(s.geometry, { height: 38, left: 85, right: 116, width: 1500 });
  assert.ok(win.document.getElementById('dsh-wco-mock'));
  s = h.configure({ simulate: 'windows' });
  assert.deepEqual(s.geometry, { height: 33, left: 0, right: 184, width: 1500 });
  s = h.configure({ enabled: false });
  assert.equal(s.active, false);
  assert.equal(win.document.getElementById('dsh-wco-mock'), null);
  assert.deepEqual(JSON.parse(win.storage['dsh.wco.settings']), { enabled: false, simulate: 'windows' });
  const again = installWcoRuntime(makeWindow({ storage: win.storage }));
  assert.equal(again.state().settings.enabled, false);
});

test('dispose removes marks, nodes, listeners and the global handle', () => {
  const overlay = fakeOverlay(WIN_RECT);
  const win = makeWindow({ overlay });
  const h = installWcoRuntime(win);
  assert.equal(win.__dshWco__, h);
  h.dispose();
  assert.equal(win.document.documentElement.hasAttribute('data-dsh-wco'), false);
  assert.equal(win.document.getElementById('dsh-wco-theme-color'), null);
  assert.equal(win.document.getElementById('dsh-wco-drag'), null);
  assert.equal(overlay.listeners.size, 0);
  assert.equal(win.__dshWco__, undefined);
});

test('a throwing overlay API never breaks the page', () => {
  const overlay = { visible: true, getTitlebarAreaRect() { throw new Error('boom'); }, addEventListener() {} };
  assert.equal(installWcoRuntime(makeWindow({ overlay })).state().active, false);
});

test('serialized script runs standalone and installs the handle', () => {
  const win = makeWindow({ overlay: fakeOverlay(WIN_RECT) });
  new Function('window', 'console', pageScriptText())(win, console);
  assert.equal(typeof win.__dshWco__?.state, 'function');
  assert.equal(win.__dshWco__.state().active, true);
});
