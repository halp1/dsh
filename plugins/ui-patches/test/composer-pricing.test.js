import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { apply } from '../src/index.js';

function indexRows(config) {
  const table = [];
  apply({
    on(event, listener) {
      assert.equal(event, 'webserver/index-inject');
      listener(table);
    },
  }, config);
  return table;
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

test('the shared patch can be disabled and rejects an invalid switch', () => {
  assert.deepEqual(indexRows({ hideComposerPricing: false }), []);
  assert.throws(() => indexRows({ hideComposerPricing: 'false' }), TypeError);
});
