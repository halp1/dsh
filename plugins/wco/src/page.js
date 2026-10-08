/**
 * The page half: a self-contained runtime that the node half serializes into
 * a `<script>` index row, so it runs in `<head>` before the client boots.
 *
 * ## What it does
 *
 * With the overlay on, the page owns the whole window, including the strip
 * where the title bar used to be. The point is to put DSH's own top rows in
 * that strip rather than to reserve an empty band for it. The page already
 * lays its top rows (sidebar logo row, conversation title row, right-panel tab
 * strip) at the top of the viewport, about as tall as a title bar. So the
 * runtime leaves the layout as it is and does four things:
 *
 * 1. **Drag.** The title-bar strip, and every row the shell marks
 *    `data-window-drag`, become `app-region: drag`; interactive elements stay
 *    `no-drag`. This is the same contract the macOS desktop shell uses.
 * 2. **Avoid the controls.** Each pass measures the top rows that intersect
 *    the controls' rectangles and pushes their content out of the way. Wide
 *    rows get extra padding on the colliding side. Narrow ones that can't
 *    spare the width (the sidebar's logo row, the collapsed rail) move down
 *    instead. It works from geometry, so it doesn't need to know any of the
 *    shell's hashed class names, and it adapts when the sidebar collapses or
 *    the right panel opens.
 * 3. **Centre the title row** on the controls, which also trims the header.
 * 4. **Colour.** Chromium paints the controls' backing with `theme-color`.
 *    The runtime keeps an opaque `theme-color` ahead of the theme presenter's
 *    meta, matched to the content background. It composites translucent
 *    themes (a background-image plugin) so the result isn't black.
 *
 * When the overlay is hidden (title bar toggled back on, fullscreen, a normal
 * tab) everything is withdrawn and the page is the plain web UI again.
 *
 * ## Constraints
 *
 * Shipped with `Function.prototype.toString`: no references to module scope,
 * and no closing script tag in the source.
 *
 * @module dsh-plugin-wco/page
 */

/** localStorage key holding per-device settings ({ enabled, simulate }). */
export const SETTINGS_KEY = 'dsh.wco.settings';

/** Devtools handle name on `window`. */
export const GLOBAL_NAME = '__dshWco__';

/**
 * Install the Window Controls Overlay runtime into a page.
 * @param {Window} win - the page window (a fake in tests).
 * @param {{ themeColor?: boolean, settingsKey?: string, globalName?: string }} [options]
 * @returns {object} the runtime handle (also parked on `win[globalName]`).
 */
export function installWcoRuntime(win, options) {
  'use strict';
  var opts = options || {};
  var settingsKey = opts.settingsKey || 'dsh.wco.settings';
  var globalName = opts.globalName || '__dshWco__';
  var wantThemeColor = opts.themeColor !== false;
  var doc = win.document;
  var root = doc.documentElement;

  var MARK = 'data-dsh-wco';
  var ADJ = 'data-dsh-wco-adjusted';
  var VARS = ['--dsh-wco-height', '--dsh-wco-inset-left', '--dsh-wco-inset-right', '--dsh-frame-overlay-top'];
  var META_ID = 'dsh-wco-theme-color';
  var DRAG_ID = 'dsh-wco-drag';
  var MOCK_ID = 'dsh-wco-mock';
  /** Top rows that may sit in the title-bar strip. */
  var CANDIDATES = '[data-window-drag], header, [class*="_pageHead"], [class*="_detailTop"]';
  /** Gap kept between content and the controls, px. */
  var GAP = 8;
  /** A row must keep at least this much content width to be pushed sideways. */
  var MIN_WIDTH = 120;
  /** Smallest vertical correction worth applying, px. */
  var MIN_LIFT = 3;

  // ── settings ────────────────────────────────────────────────────────────
  function readSettings() {
    var out = { enabled: true, simulate: null };
    try {
      var raw = win.localStorage && win.localStorage.getItem(settingsKey);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.enabled === 'boolean') out.enabled = parsed.enabled;
        if (parsed && (parsed.simulate === 'mac' || parsed.simulate === 'windows')) out.simulate = parsed.simulate;
      }
    } catch (e) { /* unavailable or corrupt: defaults */ }
    return out;
  }
  function writeSettings(s) {
    try { win.localStorage && win.localStorage.setItem(settingsKey, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  var settings = readSettings();

  // ── foreign shells ──────────────────────────────────────────────────────
  // The Electron desktop shell owns its own chrome; never compete with it.
  function foreignShell() {
    if (root.hasAttribute('data-platform')) return true;
    if (root.hasAttribute('data-windows-titlebar')) return true;
    if (typeof win.__DSH_DESKTOP_FILE_PATH__ !== 'undefined') return true;
    try {
      if (/[?&]dsh-desktop-mode=/.test(win.location.search || '')) return true;
    } catch (e) { /* no location */ }
    return false;
  }

  // ── geometry source ─────────────────────────────────────────────────────
  // Simulation fakes a plausible overlay in an ordinary tab so the layout can
  // be previewed without installing the app. Numbers measured from Chrome:
  // macOS has traffic lights on the left and the app menu on the right.
  var SIM = {
    mac: { left: 85, right: 116, height: 38 },
    windows: { left: 0, right: 184, height: 33 },
  };
  function simulatedSource(kind) {
    var listeners = [];
    var g = SIM[kind];
    return {
      simulated: kind,
      visible: true,
      getTitlebarAreaRect: function () {
        var w = win.innerWidth || 0;
        return { x: g.left, y: 0, width: Math.max(0, w - g.left - g.right), height: g.height };
      },
      addEventListener: function (t, fn) { if (t === 'geometrychange') listeners.push(fn); },
      removeEventListener: function (t, fn) {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
  }
  function pickSource() {
    if (settings.simulate) return simulatedSource(settings.simulate);
    var nav = win.navigator;
    return nav && nav.windowControlsOverlay ? nav.windowControlsOverlay : null;
  }

  /** Current geometry, or null when there is no visible overlay to adapt to. */
  function measure(source) {
    if (!source) return null;
    try {
      if (source.visible !== true) return null;
      var r = source.getTitlebarAreaRect();
      var height = Math.round(r.y + r.height);
      if (!(height > 0)) return null;
      var vw = win.innerWidth || (r.x + r.width);
      return {
        height: height,
        left: Math.max(0, Math.round(r.x)),
        right: Math.max(0, Math.round(vw - (r.x + r.width))),
        width: vw,
      };
    } catch (e) {
      return null; // a racy or hostile API must never break the page
    }
  }

  /** The controls' rectangles in viewport coordinates. */
  function controlBoxes(geo) {
    var out = [];
    if (geo.left > 0) out.push({ side: 'left', left: 0, right: geo.left, top: 0, bottom: geo.height });
    if (geo.right > 0) out.push({ side: 'right', left: geo.width - geo.right, right: geo.width, top: 0, bottom: geo.height });
    return out;
  }

  /**
   * Decide how each top row gets out of the controls' way. Pure: takes plain
   * measurements, returns style changes. Exposed on the handle for tests.
   *
   * @param rows - [{ rect, padL, padR, marginTop, leaves: [rect] }] with
   *   rect = { left, right, top, bottom }; leaves are the row's visible
   *   content boxes.
   * @param boxes - control rectangles from {@link controlBoxes}.
   * A row that moves sideways also moves up so its strip content is centred
   * on the controls. That lines it up with the other top rows, and the column
   * gets back the height the row would otherwise spend under the controls.
   *
   * @returns [{ index, paddingLeft?, paddingRight?, marginTop? }] in px.
   */
  function plan(rows, boxes) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var r = row.rect;
      var needL = 0, needR = 0, needDown = 0, lift = 0;
      for (var b = 0; b < boxes.length; b++) {
        var box = boxes[b];
        if (!(r.left < box.right && r.right > box.left && r.top < box.bottom)) continue;
        // Only content that actually sits in the strip can collide.
        var minLeft = Infinity, maxRight = -Infinity, topUnder = Infinity;
        var bandTop = Infinity, bandBottom = -Infinity;
        for (var k = 0; k < row.leaves.length; k++) {
          var l = row.leaves[k];
          if (l.top >= box.bottom || l.bottom <= box.top) continue;
          if (l.left < minLeft) minLeft = l.left;
          if (l.right > maxRight) maxRight = l.right;
          if (l.top < bandTop) bandTop = l.top;
          if (l.bottom > bandBottom) bandBottom = l.bottom;
          if (l.left < box.right && l.right > box.left && l.top < topUnder) topUnder = l.top;
        }
        if (minLeft === Infinity) continue; // nothing in the strip
        var sideways = box.side === 'left' ? box.right + GAP - minLeft : maxRight - (box.left - GAP);
        if (sideways <= 0) continue; // already clear
        var spare = (r.right - r.left) - row.padL - row.padR - needL - needR - sideways;
        if (spare >= MIN_WIDTH) {
          if (box.side === 'left') needL = Math.max(needL, sideways);
          else needR = Math.max(needR, sideways);
          // Centre the strip content on the controls, never above 2px.
          var up = Math.min((bandTop + bandBottom) / 2 - (box.top + box.bottom) / 2, bandTop - 2);
          if (up > lift) lift = up;
        } else if (topUnder !== Infinity) {
          needDown = Math.max(needDown, box.bottom + GAP / 2 - topUnder);
        }
      }
      var marginTop = undefined; // var is function-scoped: reset per row
      if (needDown > 0) marginTop = Math.ceil(row.marginTop + needDown);
      else if (lift >= MIN_LIFT) marginTop = Math.floor(row.marginTop - lift);
      if (needL > 0 || needR > 0 || marginTop !== undefined) {
        var change = { index: i };
        if (needL > 0) change.paddingLeft = Math.ceil(row.padL + needL);
        if (needR > 0) change.paddingRight = Math.ceil(row.padR + needR);
        if (marginTop !== undefined) change.marginTop = marginTop;
        out.push(change);
      }
    }
    return out;
  }

  // ── avoidance pass (DOM glue around plan) ───────────────────────────────
  var adjusted = [];
  function clearAdjustments() {
    for (var i = 0; i < adjusted.length; i++) {
      var el = adjusted[i];
      el.style.removeProperty('padding-left');
      el.style.removeProperty('padding-right');
      el.style.removeProperty('margin-top');
      el.removeAttribute(ADJ);
    }
    adjusted = [];
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  function collectRows(geo) {
    var found = doc.querySelectorAll(CANDIDATES);
    var rows = [];
    var els = [];
    for (var i = 0; i < found.length; i++) {
      var el = found[i];
      var rect = rectOf(el);
      if (rect.right - rect.left < 20 || rect.bottom - rect.top <= 0) continue;
      if (rect.top >= geo.height || rect.bottom <= 0) continue;
      // A row nested in another candidate is handled by the outer one.
      var nested = false;
      for (var j = 0; j < els.length; j++) if (els[j].contains(el)) { nested = true; break; }
      if (nested) continue;
      var cs = win.getComputedStyle(el);
      var leaves = [];
      var all = el.querySelectorAll('*');
      for (var k = 0; k < all.length; k++) {
        var d = all[k];
        if (d.childElementCount !== 0 && !/^(BUTTON|svg|IMG|INPUT)$/.test(d.nodeName)) continue;
        var lr = rectOf(d);
        if (lr.right - lr.left <= 0 || lr.bottom - lr.top <= 0) continue;
        if (lr.right <= rect.left || lr.left >= rect.right || lr.top < rect.top - 1) continue; // clipped/off-row
        leaves.push(lr);
      }
      els.push(el);
      rows.push({
        rect: rect,
        padL: parseFloat(cs.paddingLeft) || 0,
        padR: parseFloat(cs.paddingRight) || 0,
        marginTop: parseFloat(cs.marginTop) || 0,
        leaves: leaves,
      });
    }
    return { rows: rows, els: els };
  }
  var lastPlan = [];
  function avoid() {
    passQueued = false;
    clearAdjustments();
    if (!current || !doc.body) { lastPlan = []; return; }
    var collected = collectRows(current);
    var changes = plan(collected.rows, controlBoxes(current));
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i];
      var el = collected.els[c.index];
      if (c.paddingLeft !== undefined) el.style.setProperty('padding-left', c.paddingLeft + 'px', 'important');
      if (c.paddingRight !== undefined) el.style.setProperty('padding-right', c.paddingRight + 'px', 'important');
      if (c.marginTop !== undefined) el.style.setProperty('margin-top', c.marginTop + 'px', 'important');
      el.setAttribute(ADJ, '');
      adjusted.push(el);
      observeRow(el);
    }
    for (var j = 0; j < collected.els.length; j++) observeRow(collected.els[j]);
    lastPlan = changes;
  }
  var passQueued = false;
  function queuePass() {
    if (passQueued) return;
    passQueued = true;
    (win.requestAnimationFrame || function (f) { return win.setTimeout(f, 16); })(avoid);
  }
  // Rows resize when the sidebar collapses or a panel opens.
  var resizeObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(function () { queuePass(); }) : null;
  var observed = typeof WeakSet === 'function' ? new WeakSet() : null;
  function observeRow(el) {
    if (!resizeObserver || !observed || observed.has(el)) return;
    observed.add(el);
    try { resizeObserver.observe(el, { box: 'border-box' }); } catch (e) { resizeObserver.observe(el); }
  }
  /** Whether a mutation could have added, removed or moved a top row. */
  function relevant(record) {
    var lists = [record.addedNodes, record.removedNodes];
    for (var a = 0; a < 2; a++) {
      var nodes = lists[a];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.nodeType !== 1) continue;
        if (n.id === DRAG_ID || n.id === MOCK_ID) continue;
        if ((n.matches && n.matches(CANDIDATES)) || (n.querySelector && n.querySelector(CANDIDATES))) return true;
      }
    }
    if (record.type === 'attributes') {
      // data-sidebar-collapsed / data-rightbar-* on the frame, or a class swap
      // on (or around) a top row. Our own style writes are not attribute
      // records of interest: style is not in the filter.
      var t = record.target;
      if (!t || t.nodeType !== 1) return false;
      if (t.matches && t.matches(CANDIDATES)) return true;
      return !!(t.querySelector && t.querySelector(CANDIDATES));
    }
    return false;
  }

  // ── document marks ──────────────────────────────────────────────────────
  var current = null;
  function mark(geo) {
    var sides = [];
    if (geo.left > 0) sides.push('left');
    if (geo.right > 0) sides.push('right');
    root.setAttribute(MARK, sides.join(' '));
    root.style.setProperty('--dsh-wco-height', geo.height + 'px');
    root.style.setProperty('--dsh-wco-inset-left', geo.left + 'px');
    root.style.setProperty('--dsh-wco-inset-right', geo.right + 'px');
    // Shell overlays (modals, menus) keep clear of the strip through this.
    root.style.setProperty('--dsh-frame-overlay-top', (geo.height + 12) + 'px');
  }
  function unmark() {
    if (!root.hasAttribute(MARK)) return;
    root.removeAttribute(MARK);
    for (var i = 0; i < VARS.length; i++) root.style.removeProperty(VARS[i]);
  }

  // ── drag strip ──────────────────────────────────────────────────────────
  // A fixed, click-through layer over the strip so every gap in it drags the
  // window. app-region ignores pointer-events; interactive elements later in
  // the document subtract themselves with no-drag.
  function refreshDragStrip() {
    if (!doc.body) return;
    var el = doc.getElementById(DRAG_ID);
    if (!current) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = doc.createElement('div');
      el.id = DRAG_ID;
      el.setAttribute('aria-hidden', 'true');
    }
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;height:' + current.height + 'px;'
      + 'pointer-events:none;-webkit-app-region:drag;app-region:drag;';
    // First in document order, so later no-drag regions subtract from it.
    if (doc.body.firstChild !== el) doc.body.insertBefore(el, doc.body.firstChild);
  }

  // ── theme-color ─────────────────────────────────────────────────────────
  function parseRgb(text) {
    var m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)/.exec(text || '');
    if (!m) return null;
    var a = m[4] === undefined ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { r: +m[1], g: +m[2], b: +m[3], a: a };
  }
  function resolveColor(token) {
    var probe = doc.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;'
      + 'background-color:var(' + token + ')';
    doc.body.appendChild(probe);
    var color = win.getComputedStyle(probe).backgroundColor;
    probe.remove();
    return parseRgb(color);
  }
  /** Opaque colour for the controls' backing: content background, composited. */
  function controlsColor() {
    var dark = doc.body.hasAttribute('data-ds-dark-theme');
    var c = resolveColor('--dsw-alias-bg-base') || parseRgb(win.getComputedStyle(doc.body).backgroundColor);
    if (!c || c.a === 0) return dark ? 'rgb(21, 21, 23)' : 'rgb(255, 255, 255)';
    if (c.a < 1) {
      // Translucent theme (background image behind): composite over the
      // scheme's ground so the backing is close to what shows through.
      var g = dark ? 0 : 255;
      c = { r: c.r * c.a + g * (1 - c.a), g: c.g * c.a + g * (1 - c.a), b: c.b * c.a + g * (1 - c.a), a: 1 };
    }
    return 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')';
  }
  function refreshThemeColor() {
    if (!doc.head || !doc.body) return;
    var meta = doc.getElementById(META_ID);
    if (!current || !wantThemeColor) {
      if (meta) meta.remove();
      return;
    }
    var color = controlsColor();
    if (!meta) {
      meta = doc.createElement('meta');
      meta.id = META_ID;
      meta.name = 'theme-color';
    }
    if (meta.content !== color) meta.content = color;
    // First theme-color in tree order wins; keep ours ahead of the presenter's.
    if (doc.head.firstChild !== meta) doc.head.insertBefore(meta, doc.head.firstChild);
  }

  // ── simulation mock ─────────────────────────────────────────────────────
  function refreshMock(source) {
    var host = doc.getElementById(MOCK_ID);
    var sim = source && source.simulated;
    if (!sim || !current || !doc.body) {
      if (host) host.remove();
      return;
    }
    if (!host) {
      host = doc.createElement('div');
      host.id = MOCK_ID;
      host.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(host);
    }
    var stripe = 'background:repeating-linear-gradient(45deg,rgba(255,80,80,.3) 0 6px,rgba(255,80,80,.12) 6px 12px);'
      + 'outline:1px dashed rgba(255,80,80,.8);outline-offset:-1px;';
    var boxes = controlBoxes(current);
    var html = '';
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      html += '<div style="position:fixed;top:0;height:' + current.height + 'px;left:' + b.left + 'px;width:'
        + (b.right - b.left) + 'px;' + stripe + '"></div>';
    }
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  var source = null;
  var observers = [];
  function update() {
    var geo = settings.enabled && !foreignShell() ? measure(source) : null;
    current = geo;
    if (geo) mark(geo); else unmark();
    refreshDragStrip();
    refreshThemeColor();
    refreshMock(source);
    queuePass();
    return geo;
  }
  function bind() {
    if (source && source.removeEventListener) source.removeEventListener('geometrychange', update);
    source = pickSource();
    if (source && source.addEventListener) source.addEventListener('geometrychange', update);
    return update();
  }
  function onSettle(event) {
    // Sidebar collapse/expand animates; re-measure once it settles.
    var t = event && event.target;
    if (!current || !t || t.nodeType !== 1) return;
    // The animated element may be a row, inside one, or contain one.
    if ((t.closest && t.closest(CANDIDATES)) || (t.querySelector && t.querySelector(CANDIDATES))) queuePass();
  }
  function onReady() {
    update();
    if (typeof win.MutationObserver !== 'function') return;
    var domObserver = new win.MutationObserver(function (records) {
      if (!current) return;
      for (var i = 0; i < records.length; i++) if (relevant(records[i])) { queuePass(); return; }
    });
    domObserver.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // class: the sidebar swaps its root between wide/collapsed by class.
      attributeFilter: ['class', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'],
    });
    // Theme changes rewrite the body's tokens and palette attribute.
    var themeObserver = new win.MutationObserver(refreshThemeColor);
    themeObserver.observe(doc.body, { attributes: true, attributeFilter: ['style', 'data-ds-dark-theme', 'class'] });
    observers.push(domObserver, themeObserver);
  }

  bind();
  if (win.addEventListener) win.addEventListener('resize', update);
  if (doc.addEventListener) {
    doc.addEventListener('transitionend', onSettle, true);
    doc.addEventListener('animationend', onSettle, true);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();

  var handle = {
    /** Current state: whether the overlay layout is applied, and its geometry. */
    state: function () {
      return {
        active: current !== null,
        geometry: current,
        adjustments: lastPlan.length,
        settings: { enabled: settings.enabled, simulate: settings.simulate },
        supported: !!(win.navigator && win.navigator.windowControlsOverlay),
        foreignShell: foreignShell(),
      };
    },
    /**
     * Change per-device settings and re-apply.
     * enabled: false turns the adaptation off on this device.
     * simulate: 'mac' | 'windows' | null fakes an overlay in a normal tab.
     */
    configure: function (patch) {
      if (patch && typeof patch.enabled === 'boolean') settings.enabled = patch.enabled;
      if (patch && 'simulate' in patch) settings.simulate = patch.simulate === 'mac' || patch.simulate === 'windows' ? patch.simulate : null;
      writeSettings(settings);
      bind();
      return handle.state();
    },
    /** Re-measure now (synchronously). */
    refresh: function () { update(); avoid(); return handle.state(); },
    /** What the last pass measured and decided (rows that were adjusted). */
    debug: function () {
      if (!current) return [];
      clearAdjustments();
      var collected = collectRows(current);
      var changes = plan(collected.rows, controlBoxes(current));
      avoid();
      return collected.rows.map(function (row, i) {
        var el = collected.els[i];
        var change = null;
        for (var c = 0; c < changes.length; c++) if (changes[c].index === i) change = changes[c];
        return {
          row: el.nodeName + '.' + String(el.className).split(' ')[0],
          rect: row.rect,
          leavesInStrip: row.leaves.filter(function (l) { return l.top < current.height; }).length,
          change: change,
        };
      });
    },
    /** Exposed for tests. */
    plan: plan,
    controlBoxes: controlBoxes,
    /** Undo every mark and detach every listener. */
    dispose: function () {
      if (source && source.removeEventListener) source.removeEventListener('geometrychange', update);
      if (win.removeEventListener) win.removeEventListener('resize', update);
      if (doc.removeEventListener) {
        doc.removeEventListener('transitionend', onSettle, true);
        doc.removeEventListener('animationend', onSettle, true);
      }
      for (var i = 0; i < observers.length; i++) observers[i].disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      current = null;
      clearAdjustments();
      unmark();
      var ids = [META_ID, MOCK_ID, DRAG_ID];
      for (var k = 0; k < ids.length; k++) {
        var el = doc.getElementById(ids[k]);
        if (el) el.remove();
      }
      try { delete win[globalName]; } catch (e) { win[globalName] = undefined; }
    },
  };
  win[globalName] = handle;
  return handle;
}

/**
 * Static stylesheet shipped as an index `style` row; inert until the runtime
 * sets `html[data-dsh-wco]`.
 *
 * - Rows the shell marks `data-window-drag` (the same marks the macOS desktop
 *   shell uses) drag the window; interactive elements and the header's
 *   control clusters stay clickable. Chromium subtracts `no-drag` regions
 *   from `drag` ones, so popovers over the strip keep their clicks.
 * - The conversation header and the right panel's tab strip are re-centred on
 *   the controls' height instead of their fixed 10px top padding.
 */
export const BASE_CSS = [
  'html[data-dsh-wco] [data-window-drag]{-webkit-app-region:drag;app-region:drag}',
  'html[data-dsh-wco] :is(button,a,input,select,textarea,summary,[contenteditable=true],[tabindex],'
    + '[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip],[role=button],[role=link],'
    + '[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],'
    + '[role=radio],[role=switch],[role=slider],[role=combobox],[role=textbox],'
    + '[class*="_headerLeading"],[class*="_headerActions"],[class*="_headerUtilities"],[class*="_headerCorner"],'
    + '[data-dockkit-strip-tabs],[class*="_stripChrome"],[class*="_paneBody"]){-webkit-app-region:no-drag;app-region:no-drag}',
  // Title row (30px) centred in the strip; never below 2px from the top.
  'html[data-dsh-wco] header[data-window-drag]{padding-top:max(2px,calc((var(--dsh-wco-height) - 30px) / 2))}',
  // Dockkit tab strip (28px controls).
  'html[data-dsh-wco] [data-dockkit-strip][data-window-drag]{padding-top:max(2px,calc((var(--dsh-wco-height) - 28px) / 2))}',
].join('\n');

/**
 * Render the runtime as the text of an inline classic script.
 * @param {{ themeColor?: boolean }} options - forwarded to the runtime.
 * @returns {string} script text (no surrounding tag).
 */
export function pageScriptText(options = {}) {
  const payload = JSON.stringify({
    themeColor: options.themeColor !== false,
    settingsKey: SETTINGS_KEY,
    globalName: GLOBAL_NAME,
  }).replaceAll('<', '\\u003c');
  const text = `(function(){try{(${installWcoRuntime.toString()})(window,${payload})}catch(e){console.error('dsh-plugin-wco:',e)}})()`;
  if (/<\/script/i.test(text)) throw new Error('dsh-plugin-wco: page script would close its own <script> element');
  return text;
}
