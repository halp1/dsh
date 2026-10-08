import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, resolveConfig, DEFAULTS, MANIFEST_PATH } from '../src/index.js';

function fakeCtx() {
  const routes = [];
  const listeners = {};
  const disposers = [];
  return {
    routes,
    listeners,
    disposers,
    webServer: {
      register(route) {
        routes.push(route);
        return () => routes.splice(routes.indexOf(route), 1);
      },
    },
    effect(fn) { disposers.push(fn()); },
    on(name, fn) { (listeners[name] ??= []).push(fn); },
    logger: () => ({ warn() {}, info() {} }),
  };
}

test('resolveConfig fills defaults', () => {
  const c = resolveConfig();
  assert.deepEqual(c.displayOverride, DEFAULTS.displayOverride);
  assert.equal(c.manifest, true);
  assert.equal(c.layout, true);
});

test('resolveConfig rejects bad values', () => {
  assert.throws(() => resolveConfig({ displayOverride: [] }), /non-empty/);
  assert.throws(() => resolveConfig({ displayOverride: ['window'] }), /unknown display mode/);
  assert.throws(() => resolveConfig({ layout: 'yes' }), /boolean/);
  assert.throws(() => resolveConfig({ manifestFields: [] }), /object/);
  assert.throws(() => resolveConfig({ baseManifest: 3 }), /path/);
});

test('apply registers the manifest route and index rows', () => {
  const ctx = fakeCtx();
  apply(ctx, {});
  assert.equal(ctx.routes.length, 1);
  assert.equal(ctx.routes[0].kind, 'exact');
  assert.equal(ctx.routes[0].path, MANIFEST_PATH);
  const table = [];
  for (const fn of ctx.listeners['webserver/index-inject']) fn(table);
  assert.deepEqual(table.map((r) => r.kind), ['style', 'script']);
  assert.equal(table[1].placement, 'head');
  assert.doesNotMatch(table[1].text, /<\/script/i);
  assert.doesNotMatch(table[0].text, /<\/style/i);
  // Disposer removes the route.
  ctx.disposers[0]();
  assert.equal(ctx.routes.length, 0);
});

test('apply honours manifest: false and layout: false', () => {
  const ctx = fakeCtx();
  apply(ctx, { manifest: false, layout: false });
  assert.equal(ctx.routes.length, 0);
  assert.equal(ctx.listeners['webserver/index-inject'], undefined);
});

test('the injected script text is valid JavaScript', () => {
  const ctx = fakeCtx();
  apply(ctx, {});
  const table = [];
  for (const fn of ctx.listeners['webserver/index-inject']) fn(table);
  // Parses without running.
  assert.doesNotThrow(() => new Function(table[1].text));
});
