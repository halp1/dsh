import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { apply, FIRA_CODE_PATH } from '../src/index.js';

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

test('pricing stays hidden on local, remote, and mini shells without hiding other dock controls', () => {
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
      for (const row of indexRows()) {
        assert.equal(row.kind, 'style');
        const style = document.createElement('style');
        style.textContent = row.text;
        document.head.append(style);
      }
      // Later-mounted React content is covered by CSS without an observer.
      const lateBar = document.createElement('div');
      lateBar.dataset.testid = 'billing-live-cost-bar';
      document.body.append(lateBar);
      for (const capsule of document.querySelectorAll('[data-testid="billing-live-cost-bar"], [data-testid="billing-live-cost-chip"]')) {
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
  const css = table.map((row) => row.text).join('');
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
  assert.deepEqual(load({ hideComposerPricing: false, firaCode: false }), { table: [], routes: new Map() });
  for (const config of [{ hideComposerPricing: 'false' }, { firaCode: 1 }]) {
    assert.throws(() => indexRows(config), TypeError);
  }
});
