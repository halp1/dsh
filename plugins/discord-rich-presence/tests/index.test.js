import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, formatActivity, apply } from '../src/index.js';

test('resolveConfig applies defaults and validates types', () => {
  const defaults = resolveConfig({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.clientId, '1568482142072086657');
  assert.equal(defaults.details, 'DeepSeek Harness');
  assert.equal(defaults.largeImage, 'https://raw.githubusercontent.com/halp1/dsh/main/plugins/discord-rich-presence/assets/dsh.png');
  assert.equal(defaults.largeText, 'DeepSeek Harness');
  assert.equal(defaults.showFile, true);
  assert.equal(defaults.minIntervalMs, 3000);
  assert.equal(defaults.reconnectMs, 15000);
  assert.ok(Array.isArray(defaults.statuses.idle));
  assert.ok(Array.isArray(defaults.statuses.agentWorking));

  const custom = resolveConfig({
    clientId: 'custom-id',
    details: 'Custom Project',
    minIntervalMs: 5000,
    statuses: {
      idle: ['Sleeping'],
    },
  });
  assert.equal(custom.clientId, 'custom-id');
  assert.equal(custom.details, 'Custom Project');
  assert.equal(custom.minIntervalMs, 5000);
  assert.deepEqual(custom.statuses.idle, ['Sleeping']);

  assert.throws(() => resolveConfig({ clientId: 12345 }), /must be a string/);
  assert.throws(() => resolveConfig({ minIntervalMs: -10 }), /must be a positive number/);
});

test('formatActivity builds discord payload based on state and active file', () => {
  const config = resolveConfig({
    details: 'Workspace Alpha',
    largeImage: 'dsh-icon',
    largeText: 'DSH Agent',
    showFile: true,
  });

  const withFile = formatActivity('Working', config, 'main.js', 1700000000);
  assert.equal(withFile.state, 'Working');
  assert.equal(withFile.details, 'Editing main.js');
  assert.equal(withFile.timestamps.start, 1700000000);
  assert.equal(withFile.assets.large_image, 'dsh-icon');
  assert.equal(withFile.assets.large_text, 'DSH Agent');

  const withoutFile = formatActivity('Idle', config, null, 1700000000);
  assert.equal(withoutFile.state, 'Idle');
  assert.equal(withoutFile.details, 'Workspace Alpha');
});

test('apply wires event handlers and honors disabled flag', () => {
  const events = new Map();
  const logs = [];

  const fakeCtx = {
    logger: () => ({
      info: (msg) => logs.push(msg),
      warn: (msg) => logs.push(msg),
    }),
    on: (evt, handler) => {
      events.set(evt, handler);
      return () => events.delete(evt);
    },
    fs: {
      processPath: (p) => `/path/to/${p}`,
    },
  };

  apply(fakeCtx, { enabled: false });
  assert.ok(logs.some((l) => l.includes('disabled by config')));
  assert.equal(events.size, 0);

  apply(fakeCtx, { enabled: true });
  assert.ok(events.has('agent/status'));
  assert.ok(events.has('agent/inbox/inserted'));
  assert.ok(events.has('tools/pre-execute'));
  assert.ok(events.has('fs/observed'));
  assert.ok(events.has('session/created'));
  assert.ok(events.has('dispose'));

  // Trigger dispose to clean up any timers
  events.get('dispose')();
});
