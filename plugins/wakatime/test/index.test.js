import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply, buildArgs, createThrottle, isWrite, resolveConfig } from '../src/index.js';

describe('resolveConfig', () => {
  it('defaults to the cfg file for endpoint and key', () => {
    const config = resolveConfig();
    assert.equal(config.apiUrl, undefined);
    assert.equal(config.apiKey, undefined);
    assert.equal(config.category, 'ai coding');
    assert.equal(config.enabled, true);
    assert.match(config.cliPath, /wakatime-cli$/);
  });
  it('accepts a custom http(s) endpoint and rejects anything else', () => {
    assert.equal(resolveConfig({ apiUrl: 'https://waka.example/api/v1' }).apiUrl, 'https://waka.example/api/v1');
    assert.throws(() => resolveConfig({ apiUrl: 'ftp://x' }), /apiUrl/);
    assert.throws(() => resolveConfig({ apiUrl: 'nope' }), /apiUrl/);
  });
  it('honors an explicit cliPath', () => {
    assert.equal(resolveConfig({ cliPath: '/opt/wakatime-cli' }).cliPath, '/opt/wakatime-cli');
  });
});

describe('buildArgs', () => {
  it('adds endpoint and key only when configured', () => {
    const plain = buildArgs('/a.js', false, resolveConfig());
    assert.ok(!plain.includes('--api-url') && !plain.includes('--key') && !plain.includes('--write'));
    assert.deepEqual(plain.slice(0, 6), ['--entity', '/a.js', '--entity-type', 'file', '--category', 'ai coding']);

    const custom = buildArgs('/a.js', true, resolveConfig({ apiUrl: 'https://w.test/api', apiKey: 'k' }));
    assert.ok(custom.includes('--write'));
    assert.equal(custom[custom.indexOf('--api-url') + 1], 'https://w.test/api');
    assert.equal(custom[custom.indexOf('--key') + 1], 'k');
  });
});

describe('plugin tag', () => {
  it('names the editor Deepseek Harness', () => {
    const args = buildArgs('/a.js', false, resolveConfig());
    assert.match(args[args.indexOf('--plugin') + 1], /^Deepseek Harness\/\S+ dsh-plugin-wakatime\/\S+$/);
  });
});

describe('isWrite', () => {
  it('classifies the fs tools', () => {
    assert.equal(isWrite({ name: 'read' }), false);
    assert.equal(isWrite({ name: 'edit' }), true);
    assert.equal(isWrite({ name: 'write' }), true);
    assert.equal(isWrite({ name: 'str_replace_editor', arguments: { command: 'view' } }), false);
    assert.equal(isWrite({ name: 'str_replace_editor', arguments: { command: 'insert' } }), true);
    assert.equal(isWrite(undefined), false);
  });
});

describe('throttle', () => {
  it('skips repeats of the same file inside the window', () => {
    const should = createThrottle(1000);
    assert.equal(should('/a', false, 0), true);
    assert.equal(should('/a', false, 500), false);
    assert.equal(should('/b', false, 600), true);
    assert.equal(should('/b', true, 700), true);
    assert.equal(should('/b', false, 1800), true);
  });
});

function fakeCtx() {
  const listeners = {};
  const logs = [];
  const log = (level) => (msg) => logs.push([level, msg]);
  return {
    listeners,
    logs,
    on: (event, fn) => { listeners[event] = fn; },
    fs: { processPath: (target) => target.targetKey },
    logger: () => ({ info: log('info'), warn: log('warn') }),
  };
}

describe('apply', () => {
  it('sends a heartbeat per observed file and marks writes', () => {
    const ctx = fakeCtx();
    const calls = [];
    apply(ctx, { cliPath: '/bin/waka', apiUrl: 'https://w.test/api' }, (file, args) => calls.push({ file, args }));
    const observed = ctx.listeners['fs/observed'];
    observed({ targetKey: '/p/a.js' }, { kind: 'present' }, { name: 'read' });
    observed({ targetKey: '/p/a.js' }, { kind: 'present' }, { name: 'edit' });
    observed({ targetKey: '/p/b.js' }, { kind: 'absent' }, { name: 'read' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].file, '/bin/waka');
    assert.ok(!calls[0].args.includes('--write'));
    assert.ok(calls[1].args.includes('--write'));
    assert.ok(calls[1].args.includes('https://w.test/api'));
  });

  it('never throws out of the listener', () => {
    const ctx = fakeCtx();
    apply(ctx, {}, () => { throw new Error('spawn exploded'); });
    assert.doesNotThrow(() => ctx.listeners['fs/observed']({ targetKey: '/a' }, { kind: 'present' }, { name: 'read' }));
    assert.ok(ctx.logs.some(([level, msg]) => level === 'warn' && /spawn exploded/.test(msg)));
  });

  it('reports a missing CLI once', () => {
    const ctx = fakeCtx();
    apply(ctx, {}, (_f, _a, _o, cb) => cb(Object.assign(new Error('nope'), { code: 'ENOENT' })));
    ctx.listeners['fs/observed']({ targetKey: '/a' }, { kind: 'present' }, { name: 'edit' });
    ctx.listeners['fs/observed']({ targetKey: '/b' }, { kind: 'present' }, { name: 'edit' });
    assert.equal(ctx.logs.filter(([, msg]) => /not found/.test(msg)).length, 1);
  });

  it('does nothing when disabled', () => {
    const ctx = fakeCtx();
    apply(ctx, { enabled: false });
    assert.equal(ctx.listeners['fs/observed'], undefined);
  });
});
