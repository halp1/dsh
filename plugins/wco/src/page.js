/**
 * The page half: a self-contained runtime that the node half serializes into
 * a `<script>` index row, so it runs in `<head>` before the client boots.
 *
 * ## Why it reuses the Windows desktop contract
 *
 * DSH's layout already knows how to lay out under a window caption it does not
 * draw: the Windows Electron shell marks `<html data-windows-titlebar>` and
 * sets `--dsh-windows-titlebar-height` (inline, on `<html>`). With that marker
 * the frame reserves a draggable band of that height above every column, and
 * the sidebar parks its toggle and New Session buttons inside the band. That
 * is exactly the shape a Window Controls Overlay window needs, so this runtime
 * feeds the band the overlay's real geometry instead of inventing a second
 * layout. The marker is read during the first render, which is why this runs
 * before boot instead of as a client plugin.
 *
 * Two things differ from the Electron shell, and the runtime handles both:
 *
 * - **Controls on the left (macOS).** The Windows layout assumes the caption
 *   buttons sit on the right, so it pins its own buttons at the left edge,
 *   under the traffic lights. Every `position: fixed` rule scoped to
 *   `[data-windows-titlebar]` with a `left` offset gets a companion rule that
 *   adds the overlay's left inset. Rules are found by scanning the CSSOM, so
 *   hashed CSS-module class names never need to be known.
 * - **Overlay colour.** Chromium paints the controls area with the page's
 *   `theme-color`. The theme presenter sets that to the content background,
 *   while the band uses the sidebar fill. An earlier `theme-color` meta wins,
 *   so the runtime inserts one ahead of the presenter's and keeps it on the
 *   sidebar fill.
 *
 * When the overlay is hidden (the user toggled it off, the window went
 * fullscreen, or the app is in a tab) every mark is withdrawn and the page is
 * the ordinary web UI again.
 *
 * ## Constraints
 *
 * The function is shipped with `Function.prototype.toString`, so it must not
 * close over module scope, and its source must not contain a closing script
 * tag. Everything it needs comes in through its two parameters.
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
  var TITLEBAR = 'data-windows-titlebar';
  var HEIGHT_VAR = '--dsh-windows-titlebar-height';
  var VARS = ['--dsh-wco-inset-left', '--dsh-wco-inset-right', '--dsh-wco-height'];
  var SHIFT_ID = 'dsh-wco-shift';
  var META_ID = 'dsh-wco-theme-color';
  var MOCK_ID = 'dsh-wco-mock';

  // ── settings ────────────────────────────────────────────────────────────
  function readSettings() {
    var out = { enabled: true, simulate: null };
    try {
      var raw = win.localStorage && win.localStorage.getItem(settingsKey);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.enabled === 'boolean') out.enabled = parsed.enabled;
        if (parsed && (parsed.simulate === 'left' || parsed.simulate === 'right')) out.simulate = parsed.simulate;
      }
    } catch (e) { /* unavailable or corrupt: defaults */ }
    return out;
  }
  function writeSettings(s) {
    try { win.localStorage && win.localStorage.setItem(settingsKey, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  var settings = readSettings();

  // ── foreign shells ──────────────────────────────────────────────────────
  // A desktop shell (Electron preload) owns its own chrome. If it has marked
  // the document, or stamped the URL, stay out of its way entirely.
  function foreignShell() {
    if (root.hasAttribute('data-platform')) return true;
    if (root.hasAttribute(TITLEBAR) && !root.hasAttribute(MARK)) return true;
    if (typeof win.__DSH_DESKTOP_FILE_PATH__ !== 'undefined') return true;
    try {
      if (/[?&]dsh-desktop-mode=/.test(win.location.search || '')) return true;
    } catch (e) { /* no location */ }
    return false;
  }

  // ── geometry source ─────────────────────────────────────────────────────
  // Simulation fakes a plausible overlay in an ordinary tab so the layout can
  // be previewed (and tested) without installing the app.
  function simulatedSource(side) {
    var listeners = [];
    return {
      simulated: side,
      visible: true,
      getTitlebarAreaRect: function () {
        var w = win.innerWidth || 0;
        return side === 'left'
          ? { x: 78, y: 0, width: Math.max(0, w - 78 - 44), height: 32 }
          : { x: 0, y: 0, width: Math.max(0, w - 184), height: 32 };
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
      var left = Math.max(0, Math.round(r.x));
      var right = Math.max(0, Math.round(vw - (r.x + r.width)));
      // Controls sit on whichever side the title bar area leaves the larger gap.
      return { height: height, left: left, right: right, side: left > right ? 'left' : 'right' };
    } catch (e) {
      return null; // a racy or hostile API must never break the page
    }
  }

  // ── document marks ──────────────────────────────────────────────────────
  var current = null;
  function mark(geo) {
    root.setAttribute(MARK, geo.side);
    root.setAttribute(TITLEBAR, '');
    root.style.setProperty(HEIGHT_VAR, geo.height + 'px');
    root.style.setProperty('--dsh-wco-inset-left', geo.left + 'px');
    root.style.setProperty('--dsh-wco-inset-right', geo.right + 'px');
    root.style.setProperty('--dsh-wco-height', geo.height + 'px');
  }
  function unmark() {
    if (!root.hasAttribute(MARK)) return;
    root.removeAttribute(MARK);
    root.removeAttribute(TITLEBAR);
    root.style.removeProperty(HEIGHT_VAR);
    for (var i = 0; i < VARS.length; i++) root.style.removeProperty(VARS[i]);
  }

  // ── left-inset companion rules ──────────────────────────────────────────
  function eachStyleRule(rules, visit) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (rule.cssRules && !rule.style) eachStyleRule(rule.cssRules, visit); // @media / @supports / @layer
      else if (rule.style && typeof rule.selectorText === 'string') visit(rule);
    }
  }
  /**
   * Companion rules shifting fixed caption controls right by the left inset.
   * Exposed on the handle for tests.
   */
  function shiftRules(sheets) {
    var out = [];
    var seen = {};
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      if (sheet.ownerNode && sheet.ownerNode.id === SHIFT_ID) continue;
      var rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin
      if (!rules) continue;
      eachStyleRule(rules, function (rule) {
        if (rule.selectorText.indexOf(TITLEBAR) < 0) return;
        if (rule.style.getPropertyValue('position') !== 'fixed') return;
        var left = rule.style.getPropertyValue('left');
        if (!left || left === 'auto') return;
        var text = 'html[' + MARK + '="left"] :is(' + rule.selectorText + '){left:calc(' + left + ' + var(--dsh-wco-inset-left, 0px))}';
        if (!seen[text]) { seen[text] = true; out.push(text); }
      });
    }
    return out;
  }
  var shiftQueued = false;
  function refreshShift() {
    shiftQueued = false;
    if (!doc.head) return;
    var el = doc.getElementById(SHIFT_ID);
    if (!current || current.side !== 'left') {
      if (el) el.remove();
      return;
    }
    var css = shiftRules(doc.styleSheets || []).join('\n');
    if (!el) {
      el = doc.createElement('style');
      el.id = SHIFT_ID;
      doc.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }
  function queueShift() {
    if (shiftQueued) return;
    shiftQueued = true;
    (win.requestAnimationFrame || function (f) { return win.setTimeout(f, 16); })(refreshShift);
  }

  // ── theme-color ─────────────────────────────────────────────────────────
  function refreshThemeColor() {
    if (!doc.head || !doc.body) return;
    var meta = doc.getElementById(META_ID);
    if (!current || !wantThemeColor) {
      if (meta) meta.remove();
      return;
    }
    // Resolve the band's fill through a probe so the meta gets a concrete
    // rgb() even when the token is a var()/color-mix() expression, which
    // theme-color parsing does not accept.
    var probe = doc.createElement('span');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;'
      + 'background-color:var(--dsw-specific-sidebar-fill)';
    doc.body.appendChild(probe);
    var color = win.getComputedStyle(probe).backgroundColor;
    probe.remove();
    var clear = /^rgba\(0, 0, 0, 0\)$|^transparent$/;
    if (!color || clear.test(color)) color = win.getComputedStyle(doc.body).backgroundColor;
    if (!color || clear.test(color)) return; // theme not applied yet; the body observer retries
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
    var el = doc.getElementById(MOCK_ID);
    var sim = source && source.simulated;
    if (!sim || !current || !doc.body) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = doc.createElement('div');
      el.id = MOCK_ID;
      el.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(el);
    }
    var w = sim === 'left' ? current.left : current.right;
    el.style.cssText = 'position:fixed;top:0;z-index:2147483647;pointer-events:none;'
      + 'height:' + current.height + 'px;width:' + w + 'px;' + (sim === 'left' ? 'left:0;' : 'right:0;')
      + 'background:repeating-linear-gradient(45deg,rgba(255,80,80,.28) 0 6px,rgba(255,80,80,.12) 6px 12px);'
      + 'outline:1px dashed rgba(255,80,80,.8);outline-offset:-1px;';
  }

  // ── wiring ──────────────────────────────────────────────────────────────
  var source = null;
  var observers = [];
  function update() {
    var geo = settings.enabled && !foreignShell() ? measure(source) : null;
    current = geo;
    if (geo) mark(geo); else unmark();
    queueShift();
    refreshThemeColor();
    refreshMock(source);
    return geo;
  }
  function bind() {
    if (source && source.removeEventListener) source.removeEventListener('geometrychange', update);
    source = pickSource();
    if (source && source.addEventListener) source.addEventListener('geometrychange', update);
    return update();
  }
  function onReady() {
    update();
    if (typeof win.MutationObserver !== 'function') return;
    // New stylesheets (client plugins inject theirs as they load) may carry
    // more caption rules to shift.
    var headObserver = new win.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var nodes = records[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.id !== SHIFT_ID && (n.nodeName === 'STYLE' || n.nodeName === 'LINK')) { queueShift(); return; }
        }
      }
    });
    headObserver.observe(doc.head, { childList: true });
    // Theme changes rewrite the body's token variables and palette attribute.
    var bodyObserver = new win.MutationObserver(refreshThemeColor);
    bodyObserver.observe(doc.body, { attributes: true, attributeFilter: ['style', 'data-ds-dark-theme', 'class'] });
    observers.push(headObserver, bodyObserver);
  }

  bind();
  if (win.addEventListener) win.addEventListener('resize', update);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();

  var handle = {
    /** Current state: whether the overlay layout is applied, and its geometry. */
    state: function () {
      return {
        active: current !== null,
        geometry: current,
        settings: { enabled: settings.enabled, simulate: settings.simulate },
        supported: !!(win.navigator && win.navigator.windowControlsOverlay),
        foreignShell: foreignShell(),
      };
    },
    /**
     * Change per-device settings and re-apply.
     * enabled: false turns the adaptation off on this device.
     * simulate: 'left' | 'right' | null fakes an overlay in a normal tab.
     */
    configure: function (patch) {
      if (patch && typeof patch.enabled === 'boolean') settings.enabled = patch.enabled;
      if (patch && 'simulate' in patch) settings.simulate = patch.simulate === 'left' || patch.simulate === 'right' ? patch.simulate : null;
      writeSettings(settings);
      bind();
      return handle.state();
    },
    /** Re-measure now. */
    refresh: update,
    /** Exposed for tests. */
    shiftRules: shiftRules,
    /** Undo every mark and detach every listener. */
    dispose: function () {
      if (source && source.removeEventListener) source.removeEventListener('geometrychange', update);
      if (win.removeEventListener) win.removeEventListener('resize', update);
      for (var i = 0; i < observers.length; i++) observers[i].disconnect();
      current = null;
      unmark();
      var ids = [SHIFT_ID, META_ID, MOCK_ID];
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
 * Static stylesheet shipped as an index `style` row.
 *
 * The frame's caption band is an `app-region: drag` pseudo-element. Chromium
 * subtracts only elements that declare `no-drag`, so anything that pops over
 * the band (menus, tooltips, dialogs) would otherwise start a window drag
 * instead of receiving the click. The Electron shell carries the same list for
 * macOS under `[data-platform=darwin]`; this scopes it to the overlay mark.
 */
export const BASE_CSS = [
  'html[data-dsh-wco] :is(button,a,input,select,textarea,summary,[contenteditable=true],[tabindex],'
    + '[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip],[role=button],[role=link],'
    + '[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],'
    + '[role=radio],[role=switch],[role=slider],[role=combobox],[role=textbox]){-webkit-app-region:no-drag;app-region:no-drag}',
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
