import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PauseController, PausedError } from '../src/state.js';
import { resolveConfig } from '../src/index.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function harness(overrides = {}, probeResults = [true]) {
  const config = resolveConfig({ resumeDelayMs: 5, probe: { retryMs: 5 }, ...overrides });
  const events = [];
  let probes = 0;
  const gate = new PauseController({
    config,
    probe: async () => probeResults[Math.min(probes++, probeResults.length - 1)],
    onChange: (status) => events.push(status.event),
  });
  return { gate, events, probeCount: () => probes };
}

const cases = [
  {
    name: 'lid close then open with network up resumes after the probe',
    steps: [['lid', true], ['lid', false]],
    open: true,
    events: ['paused', 'probing', 'settling', 'resumed'],
  },
  {
    name: 'lid opens while offline and waits for the network',
    steps: [['lid', true], ['net', false], ['lid', false]],
    open: false,
    events: ['paused', 'waiting-network'],
  },
  {
    name: 'network returning after lid open resumes',
    steps: [['lid', true], ['net', false], ['lid', false], ['net', true]],
    open: true,
    events: ['paused', 'waiting-network', 'probing', 'settling', 'resumed'],
  },
  {
    name: 'sleep and wake without a lid change resumes',
    steps: [['power', 'will-sleep'], ['power', 'did-wake']],
    open: true,
    events: ['paused', 'probing', 'settling', 'resumed'],
  },
  {
    name: 'waking with the lid still closed stays paused',
    steps: [['lid', true], ['power', 'will-sleep'], ['power', 'did-wake']],
    open: false,
    events: ['paused'],
  },
  {
    name: 'network loss alone does not pause by default',
    steps: [['net', false]],
    open: true,
    events: [],
  },
  {
    name: 'network loss pauses when configured',
    config: { pauseOnNetworkLoss: true },
    steps: [['net', false], ['net', true]],
    open: true,
    events: ['paused', 'probing', 'settling', 'resumed'],
  },
  {
    name: 'lid close is ignored when pauseOnLidClose is off',
    config: { pauseOnLidClose: false },
    steps: [['lid', true]],
    open: true,
    events: [],
  },
];

for (const c of cases) {
  test(`state: ${c.name}`, async () => {
    const { gate, events } = harness(c.config);
    for (const [kind, value] of c.steps) {
      if (kind === 'lid') gate.setLid(value);
      if (kind === 'net') gate.setNetwork(value);
      if (kind === 'power') gate.setPower(value);
      await tick(20);
    }
    assert.equal(gate.isOpen(), c.open);
    assert.deepEqual(events, c.events);
    gate.dispose();
  });
}

test('state: failing probe retries until connectivity returns', async () => {
  const { gate, probeCount } = harness({}, [false, false, true]);
  gate.setLid(true);
  gate.setLid(false);
  await tick(80);
  assert.equal(gate.isOpen(), true);
  assert.equal(probeCount(), 3);
  gate.dispose();
});

test('state: closing during the settle delay cancels the resume', async () => {
  const { gate } = harness({ resumeDelayMs: 30 });
  gate.setLid(true);
  gate.setLid(false);
  await tick(5);
  gate.setLid(true);
  await tick(60);
  assert.equal(gate.isOpen(), false);
  gate.dispose();
});

test('state: waiters release on resume, the pause signal fires once per pause, abort rejects', async () => {
  const { gate } = harness();
  const firstSignal = gate.pauseSignal;
  gate.setLid(true);
  assert.equal(firstSignal.aborted, true);
  assert.ok(firstSignal.reason instanceof PausedError);
  assert.deepEqual(firstSignal.reason.reasons, ['lid closed']);

  const released = gate.wait();
  const controller = new AbortController();
  const cancelled = gate.wait(controller.signal);
  controller.abort(new Error('stop pressed'));
  await assert.rejects(cancelled, /stop pressed/);
  assert.equal(gate.status().held, 1);

  gate.setLid(false);
  assert.equal(await released, true);
  assert.equal(gate.pauseSignal.aborted, false);
  assert.notEqual(gate.pauseSignal, firstSignal);
  assert.equal(gate.inWakeGrace(), false);
  gate.dispose();
});

test('state: did-wake starts the grace window and dispose frees held callers', async () => {
  const { gate } = harness();
  gate.setPower('did-wake');
  assert.equal(gate.inWakeGrace(), true);
  gate.setLid(true);
  const held = gate.wait();
  gate.dispose();
  assert.equal(await held, true);
  assert.equal(gate.isOpen(), true);
});
