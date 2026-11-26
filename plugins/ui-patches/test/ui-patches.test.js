import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { apply, FIRA_CODE_PATH, MOBILE_ENTER_NEWLINE_SCRIPT } from '../src/index.js';

function load(config) {
  const table = [];
  const routes = new Map();
  apply({
    on(event, listener) {
      assert.equal(event, 'webserver/index-inject');
      listener(table);
    },
    effect(start) {
      start();
    },
    webServer: {
      register(route) {
        routes.set(route.path, route);
      },
    },
  }, config);
  return { table, routes };
}

const indexRows = (config) => load(config).table;

async function request(route, method) {
  const headers = {};
  let body;
  await new Promise((resolve) => {
    const res = {
      statusCode: 0,
      setHeader: (key, value) => { headers[key] = value; },
      end: (chunk) => { body = chunk; resolve(); },
    };
    route.handler({ method }, res);
  });
  return { headers, body };
}

test('pricing and Cursor stats stay hidden on local, remote, and mini shells without hiding other dock controls', () => {
  for (const [url, className] of [
    ['http://127.0.0.1:3080', ''],
    ['https://dsh.example.test', ''],
    ['https://dsh.example.test', 'dsh-remote-portrait'],
    ['http://127.0.0.1:3080', 'dshmini-root'],
  ]) {
    const dom = new JSDOM(`<!doctype html><html><head></head><body class="${className}">
      <aside><button data-testid="billing-dashboard-trigger">Billing</button></aside>
      <main data-slot="conversation.composer.bar">
        <textarea aria-label="Message"></textarea>
        <div data-slot="conversation.composer.dock">
          <div data-testid="billing-live-cost-bar">Off-peak Turn $0 Session $0</div>
          <div class="dcp-cursor-context">Context 16%</div>
          <span class="cu-dock"><span class="cu-status-row">Checkpoint</span><button class="cu-pill">Cursor 0%</button></span>
          <button data-testid="other-dock-control">Other plugin</button>
        </div>
        <div data-slot="conversation.input.right">
          <span data-testid="billing-live-cost-chip">Peak $0</span>
          <button data-testid="send">Send</button>
        </div>
      </main>
    </body></html>`, { url });
    try {
      const { document, getComputedStyle } = dom.window;
      // A remote origin with no saved billing preference reproduces the bug.
      assert.equal(dom.window.localStorage.length, 0);
      const display = (selector) => getComputedStyle(document.querySelector(selector)).display;
      assert.notEqual(display('[data-testid="billing-live-cost-bar"]'), 'none');
      for (const row of indexRows().filter((r) => r.kind === 'style')) {
        const style = document.createElement('style');
        style.textContent = row.text;
        document.head.append(style);
      }
      // Later-mounted React content is covered by CSS without an observer.
      const lateBar = document.createElement('div');
      lateBar.dataset.testid = 'billing-live-cost-bar';
      document.body.append(lateBar);
      for (const capsule of document.querySelectorAll('[data-testid="billing-live-cost-bar"], [data-testid="billing-live-cost-chip"], .cu-dock, .dcp-cursor-context')) {
        assert.equal(getComputedStyle(capsule).display, 'none', url + ' ' + className);
      }
      for (const selector of ['textarea', '[data-testid="billing-dashboard-trigger"]', '[data-testid="other-dock-control"]', '[data-testid="send"]', '[data-slot="conversation.composer.dock"]']) {
        assert.notEqual(display(selector), 'none', selector);
      }
      assert.equal(dom.window.localStorage.length, 0);
    } finally {
      dom.window.close();
    }
  }
});

test('Fira Code is served by the host and only replaces the default code stack', async () => {
  const { table, routes } = load();
  const css = table.filter((row) => row.kind === 'style').map((row) => row.text).join('');
  assert.match(css, new RegExp(`url\\("${FIRA_CODE_PATH}"\\)`));
  // The user's Settings > Code font override must keep precedence.
  assert.match(css, /--dsh-font-family-code-default:\s*"Fira Code"/);
  assert.doesNotMatch(css, /--(dsh|ds)-font-family-code:/);

  const route = routes.get(FIRA_CODE_PATH);
  const get = await request(route, 'GET');
  assert.equal(get.headers['content-type'], 'font/woff2');
  assert.equal(get.body.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.equal(get.headers['content-length'], get.body.length);
  assert.equal((await request(route, 'HEAD')).body, undefined);
  assert.equal((await request(route, 'POST')).headers.allow, 'GET, HEAD');
});

test('each patch can be disabled independently and rejects an invalid switch', () => {
  const pricingOnly = load({ firaCode: false });
  assert.equal(pricingOnly.routes.size, 0);
  assert.doesNotMatch(pricingOnly.table[0].text, /Fira Code/);
  assert.doesNotMatch(indexRows({ hideComposerPricing: false })[0].text, /billing-live-cost/);
  assert.match(indexRows({ hideComposerPricing: false })[0].text, /\.cu-dock/);
  assert.doesNotMatch(indexRows({ hideCursorStats: false })[0].text, /\.cu-dock|dcp-cursor-context/);
  assert.deepEqual(load({ hideComposerPricing: false, hideCursorStats: false, composerOneLine: false, firaCode: false, mobileEnterNewline: false }), { table: [], routes: new Map() });
  assert.ok(indexRows().some((row) => row.kind === 'script'));
  assert.ok(!indexRows({ mobileEnterNewline: false }).some((row) => row.kind === 'script'));
  for (const config of [{ hideComposerPricing: 'false' }, { hideCursorStats: 'off' }, { composerOneLine: 0 }, { firaCode: 1 }, { mobileEnterNewline: 'no' }]) {
    assert.throws(() => indexRows(config), TypeError);
  }
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

test('mobile Enter reaches the browser as a line break instead of the submit keymap', () => {
  const cases = [
    // [name, userAgent, keydown init, setup, composer keymap expected to see the key]
    ['plain Enter on a phone', IPHONE, {}, null, false],
    ['plain Enter on desktop', MAC, {}, null, true],
    ['Shift+Enter on a phone', IPHONE, { shiftKey: true }, null, true],
    ['IME commit on a phone', IPHONE, { isComposing: true }, null, true],
    ['highlighted slash candidate on a phone', IPHONE, {}, (doc) => {
      doc.body.insertAdjacentHTML('beforeend', '<div data-trigger-menu><div role="listbox" aria-activedescendant="opt-0"></div></div>');
    }, true],
    ['Enter in another editable on a phone', IPHONE, {}, (doc) => {
      doc.querySelector('[data-composer-input]').removeAttribute('data-composer-input');
    }, true],
  ];
  for (const [name, userAgent, init, setup, expectKeymap] of cases) {
    const dom = new JSDOM('<!doctype html><body><div contenteditable="true" role="textbox" data-composer-input><p>hi</p></div></body>', {
      runScripts: 'outside-only',
      beforeParse(window) {
        Object.defineProperty(window.navigator, 'userAgent', { value: userAgent });
      },
    });
    try {
      const { window } = dom;
      window.eval(MOBILE_ENTER_NEWLINE_SCRIPT);
      setup?.(window.document);
      const input = window.document.querySelector('[contenteditable]');
      // Lexical's root keydown listener, which submits and prevents default.
      let keymapSaw = false;
      input.addEventListener('keydown', (event) => {
        keymapSaw = true;
        event.preventDefault();
      });
      const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
      input.firstChild.dispatchEvent(event);
      assert.equal(keymapSaw, expectKeymap, name);
      // The browser must keep the default so it emits insertParagraph.
      assert.equal(event.defaultPrevented, expectKeymap, name);
    } finally {
      dom.window.close();
    }
  }
});

// remote-web-ui 0.4.16's portrait rules that split the composer toolbar.
const REMOTE_PORTRAIT_CSS = `
[class$="_composerSeat"] [class$="_row"]{flex-wrap:wrap;row-gap:0;padding:2px 8px 1px;position:relative}
[class$="_composerSeat"] [class$="_trailing"]{box-sizing:border-box;flex-basis:100%;min-height:32px;justify-content:flex-start;padding-left:38px;padding-right:78px}
`;

test('portrait composer controls stay on one line only under the remote portrait layer', () => {
  for (const [bodyClass, meter, expected] of [
    ['dsh-remote-portrait', false, { wrap: 'nowrap', basis: 'auto', reserve: '52px' }],
    ['dsh-remote-portrait', true, { wrap: 'nowrap', basis: 'auto', reserve: '78px' }],
    ['', false, { wrap: 'wrap', basis: '100%', reserve: '8px' }],
  ]) {
    const dom = new JSDOM(`<!doctype html><body class="${bodyClass}"><div class="x_composerSeat">
      <div class="x_row"><div class="x_tools"><button class="x_add"></button></div>
        <div class="x_trailing"><div class="x_standardControls"></div>${meter ? '<div class="x_root"><i class="x_track"></i></div>' : ''}<button class="x_primary"></button></div>
      </div></div></body>`);
    try {
      const { document, getComputedStyle } = dom.window;
      for (const text of [REMOTE_PORTRAIT_CSS, ...indexRows().filter((r) => r.kind === 'style').map((r) => r.text)]) {
        const style = document.createElement('style');
        style.textContent = text;
        document.head.append(style);
      }
      const row = getComputedStyle(document.querySelector('.x_row'));
      const trailing = getComputedStyle(document.querySelector('.x_trailing'));
      const label = `${bodyClass || 'desktop'} meter=${meter}`;
      assert.equal(row.flexWrap, expected.wrap, label);
      assert.equal(trailing.flexBasis, expected.basis, label);
      assert.equal(row.paddingRight, expected.reserve, label);
    } finally {
      dom.window.close();
    }
  }
  assert.ok(!indexRows({ composerOneLine: false }).some((r) => r.kind === 'style' && r.text.includes('dsh-remote-portrait')));
});
