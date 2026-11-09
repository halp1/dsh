import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LidWatcher, lineSplitter, parseEvent } from '../src/watcher.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end() {} };
  child.kill = () => {};
  return child;
}

test('lineSplitter and parseEvent handle split, malformed, and unknown lines', () => {
  const split = lineSplitter();
  assert.deepEqual(split('{"type":"lid","clo'), []);
  const lines = split('sed":true}\nnot json\n{"type":"weird"}\n{"type":"power","state":"did-wake"}\n{"type":"net');
  assert.deepEqual(lines.map(parseEvent), [
    { type: 'lid', closed: true },
    undefined,
    undefined,
    { type: 'power', state: 'did-wake' },
  ]);
  assert.deepEqual(parseEvent('{"type":"lid","closed":"yes"}'), undefined);
  assert.deepEqual(parseEvent('{"type":"power","state":"nap"}'), undefined);
  assert.deepEqual(parseEvent('{"type":"snapshot","lidClosed":true,"networkUp":false,"interfaces":["wifi"]}'), {
    type: 'snapshot',
    lidClosed: true,
    networkUp: false,
    interfaces: ['wifi'],
  });
});

test('watcher restarts the helper with backoff after it exits and stops cleanly', async () => {
  const children = [];
  const events = [];
  const watcher = new LidWatcher({
    binary: '/bin/lidwatch',
    onEvent: (e) => events.push(e),
    logger: { info() {}, warn() {} },
    watchdogMs: 0,
    restartBaseMs: 5,
    spawn: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
  });
  watcher.start();
  children[0].stdout.emit('data', '{"type":"lid","closed":true}\n');
  children[0].emit('exit', 1, null);
  await tick(20);
  assert.equal(children.length, 2);
  children[1].stdout.emit('data', '{"type":"lid","closed":false}\n');
  assert.deepEqual(events, [
    { type: 'lid', closed: true },
    { type: 'lid', closed: false },
  ]);
  watcher.stop();
  children[1].emit('exit', null, 'SIGTERM');
  await tick(20);
  assert.equal(children.length, 2);
});

test('watchdog reports a clock jump as a wake', () => {
  let now = 0;
  const events = [];
  const watcher = new LidWatcher({
    binary: 'x',
    onEvent: (e) => events.push(e),
    logger: { info() {}, warn() {} },
    spawn: () => fakeChild(),
    now: () => now,
    watchdogMs: 1000,
    jumpMs: 30_000,
  });
  watcher.start();
  now = 5000;
  watcher.tick();
  now = 5000 + 10 * 60_000;
  watcher.tick();
  watcher.stop();
  assert.deepEqual(events, [{ type: 'power', state: 'did-wake', synthetic: true }]);
});
