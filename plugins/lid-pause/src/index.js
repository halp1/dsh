/**
 * dsh-plugin-lid-pause: hold every running agent (top-level turns,
 * subagents, and agent-team teammates) while the MacBook lid is closed or the
 * system sleeps, and continue the same turns once the lid is open and the
 * network actually works again.
 *
 * ## How the pause works
 *
 * Three waterfall listeners share one gate.
 *
 * - `llm/stream`: every model call waits for the gate before it is sent. A
 *   call that is mid-stream when the gate closes is cut off and ends with a
 *   `LID_PAUSED` error chunk, which the agent loop records as a
 *   non-model-visible attempt.
 * - `agent/request-error` (prepended, so it runs before dsh-llm-retry): a
 *   `LID_PAUSED` failure, or a transport failure while paused or just after a
 *   wake, waits for the gate and re-runs the same step. These never end a
 *   turn and never spend the retry budget.
 * - `tools/execute`: new tool dispatches wait for the gate. Tool bodies that
 *   are already running are left alone.
 *
 * Nothing is cancelled and nothing is re-prompted. Stop still works while
 * held, because every wait honors the caller's abort signal.
 *
 * @module dsh-plugin-lid-pause
 */

import { connect } from 'node:net';
import { PauseController, PausedError } from './state.js';
import { LidWatcher, resolveBinary } from './watcher.js';

export const name = 'lid-pause';

export { PauseController, PausedError, LidWatcher };

/** Failure code written into the synthetic finish chunk of an interrupted stream. */
export const LID_PAUSED_CODE = 'LID_PAUSED';

/** Failures that a dead pre-sleep socket produces. */
const NETWORK_FAILURE_CODES = new Set(['TRANSPORT', 'TIMEOUT', 'SERVER']);

const TOOL_ABORTED_BEFORE_DISPATCH = 'ABORTED_BEFORE_DISPATCH';

const DEFAULTS = {
  enabled: true,
  pauseOnLidClose: true,
  pauseOnSleep: true,
  pauseOnNetworkLoss: false,
  interruptInFlight: true,
  holdTools: true,
  resumeDelayMs: 2000,
  wakeGraceMs: 120_000,
  sleepDelayMs: 1000,
  probe: { host: 'cloudflare.com', port: 443, timeoutMs: 3000, retryMs: 2000 },
};

function nonNegative(value, key, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`lid-pause: ${key} must be a number between 0 and ${max}`);
  }
  return value;
}

function bool(value, key) {
  if (typeof value !== 'boolean') throw new Error(`lid-pause: ${key} must be true or false`);
  return value;
}

/**
 * Validate and default the plugin config.
 * @param raw - the user's config section.
 * @returns the resolved, frozen config.
 */
export function resolveConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object') throw new Error('lid-pause: config must be an object');
  const pick = (key) => raw[key] ?? DEFAULTS[key];

  let probe = false;
  if (raw.probe !== false) {
    const p = { ...DEFAULTS.probe, ...(raw.probe ?? {}) };
    if (typeof p.host !== 'string' || p.host === '') throw new Error('lid-pause: probe.host must be a hostname');
    if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) throw new Error('lid-pause: probe.port must be 1..65535');
    probe = Object.freeze({
      host: p.host,
      port: p.port,
      timeoutMs: nonNegative(p.timeoutMs, 'probe.timeoutMs', 60_000),
      retryMs: nonNegative(p.retryMs, 'probe.retryMs', 600_000),
    });
  }

  const config = {
    enabled: bool(pick('enabled'), 'enabled'),
    pauseOnLidClose: bool(pick('pauseOnLidClose'), 'pauseOnLidClose'),
    pauseOnSleep: bool(pick('pauseOnSleep'), 'pauseOnSleep'),
    pauseOnNetworkLoss: bool(pick('pauseOnNetworkLoss'), 'pauseOnNetworkLoss'),
    interruptInFlight: bool(pick('interruptInFlight'), 'interruptInFlight'),
    holdTools: bool(pick('holdTools'), 'holdTools'),
    resumeDelayMs: nonNegative(pick('resumeDelayMs'), 'resumeDelayMs', 600_000),
    wakeGraceMs: nonNegative(pick('wakeGraceMs'), 'wakeGraceMs', 3_600_000),
    sleepDelayMs: nonNegative(pick('sleepDelayMs'), 'sleepDelayMs', 25_000),
    probe,
  };
  if (!config.pauseOnLidClose && !config.pauseOnSleep && !config.pauseOnNetworkLoss) {
    throw new Error('lid-pause: at least one of pauseOnLidClose, pauseOnSleep, pauseOnNetworkLoss must be on');
  }
  return Object.freeze(config);
}

/**
 * Open a TCP connection to prove the network carries traffic.
 * @returns whether the connection succeeded within the timeout.
 */
export function tcpProbe({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function pausedChunk(reasons) {
  return {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: { code: LID_PAUSED_CODE, message: `Paused by lid-pause (${reasons.join(', ') || 'paused'})` },
    },
  };
}

function abortedBeforeDispatch() {
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  };
}

const PAUSE = Symbol('pause');

/**
 * Wrap a chunk stream so it ends with a `LID_PAUSED` finish when the gate
 * closes mid-stream.
 *
 * The inner iterator's pending step is raced against the pause signal rather
 * than awaited, because an adapter blocked on a socket read would otherwise
 * keep the turn hanging until the dead connection times out after wake.
 * @param source - the downstream chunk iterable.
 * @param pauseSignal - fires when the current open period ends.
 * @param onInterrupt - told when a stream is cut off.
 */
export async function* interruptible(source, pauseSignal, onInterrupt = () => {}) {
  const iterator = source[Symbol.asyncIterator]();
  let onPause;
  const paused = new Promise((resolve) => {
    onPause = () => resolve(PAUSE);
    if (pauseSignal.aborted) resolve(PAUSE);
    else pauseSignal.addEventListener('abort', onPause, { once: true });
  });
  let finished = false;
  try {
    while (true) {
      const step = iterator.next();
      const result = await Promise.race([step, paused]);
      if (result === PAUSE) {
        step.catch(() => {});
        const reasons = pauseSignal.reason instanceof PausedError ? pauseSignal.reason.reasons : [];
        onInterrupt(reasons);
        yield pausedChunk(reasons);
        return;
      }
      if (result.done) {
        finished = true;
        return;
      }
      yield result.value;
      if (result.value?.type === 'finish') {
        finished = true;
        return;
      }
    }
  } finally {
    pauseSignal.removeEventListener('abort', onPause);
    if (!finished) {
      // Fire and forget: return() on a generator parked in an await only
      // settles once that await does.
      Promise.resolve()
        .then(() => iterator.return?.())
        .catch(() => {});
    }
  }
}

async function loadAgentLoopCheck() {
  try {
    const llm = await import('@deepseek-ai/dsh-llm');
    if (typeof llm.isAgentLoopRequest === 'function') return llm.isAgentLoopRequest;
  } catch {
    // Not resolvable from this install. Fall back to the session id below.
  }
  return (options) => options?.sessionId !== undefined;
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Install the listeners on a gate. Split from `apply` so tests can drive it
 * with a fake context and a controller they own.
 */
export function installListeners(ctx, { gate, config, logger, isAgentLoopRequest }) {
  const counters = { interrupted: 0 };

  ctx.on('llm/stream', async function* (options, next) {
    if (!gate.isOpen()) {
      await gate.wait(options.signal);
    }
    const interrupt = config.interruptInFlight && isAgentLoopRequest(options);
    if (!interrupt) {
      yield* next();
      return;
    }
    yield* interruptible(next(), gate.pauseSignal, () => {
      counters.interrupted += 1;
    });
  });

  ctx.on(
    'agent/request-error',
    async (payload, next) => {
      const { failure, signal } = payload;
      const code = failure?.code;
      const ours = code === LID_PAUSED_CODE;
      const network = NETWORK_FAILURE_CODES.has(code) && (!gate.isOpen() || gate.inWakeGrace());
      if (!ours && !network) return next();
      if (signal?.aborted) return next();
      await gate.wait(signal);
      if (!ours) logger.info(`lid-pause: retrying a ${code} failure from the sleep window`);
      return { kind: 'retry' };
    },
    { prepend: true },
  );

  if (config.holdTools) {
    ctx.on('tools/execute', async (exec, next) => {
      if (gate.isOpen()) return next();
      try {
        await gate.wait(exec.signal);
      } catch {
        return abortedBeforeDispatch();
      }
      return next();
    });
  }

  return counters;
}

/**
 * Plugin entry.
 * @param ctx - cordis context.
 * @param rawConfig - the user's config section.
 */
export async function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const logger = ctx.logger('lid-pause');

  if (!config.enabled) {
    logger.info('lid-pause: disabled by config');
    return;
  }
  if (process.platform !== 'darwin') {
    logger.info('lid-pause: macOS only, staying inactive');
    return;
  }

  let counters = { interrupted: 0 };
  const gate = new PauseController({
    config,
    probe: config.probe === false ? undefined : () => tcpProbe(config.probe),
    onChange: (status) => {
      switch (status.event) {
        case 'paused':
          logger.warn(`lid-pause: paused (${status.reasons.join(', ')}), holding model and tool calls`);
          break;
        case 'waiting-network':
          logger.info('lid-pause: lid open, waiting for the network');
          break;
        case 'probing':
          logger.info('lid-pause: network up, checking connectivity');
          break;
        case 'resumed':
          logger.info(
            `lid-pause: resumed after ${formatDuration(status.pausedFor)}` +
              `, released ${status.released} held call(s), interrupted ${counters.interrupted} stream(s)`,
          );
          counters.interrupted = 0;
          break;
        default:
          break;
      }
    },
  });

  counters = installListeners(ctx, {
    gate,
    config,
    logger,
    isAgentLoopRequest: await loadAgentLoopCheck(),
  });

  let binary;
  try {
    binary = await resolveBinary({ logger });
  } catch (error) {
    logger.warn(`lid-pause: native helper unavailable, staying inactive: ${error.message}`);
    gate.dispose();
    return;
  }

  const watcher = new LidWatcher({
    binary,
    logger,
    sleepDelayMs: config.sleepDelayMs,
    onEvent: (event) => {
      switch (event.type) {
        case 'snapshot':
          gate.setNetwork(event.networkUp);
          gate.setLid(event.lidClosed);
          break;
        case 'lid':
          gate.setLid(event.closed);
          break;
        case 'power':
          gate.setPower(event.state);
          break;
        case 'network':
          gate.setNetwork(event.up);
          break;
        default:
          break;
      }
    },
  });
  watcher.start();
  logger.info(`lid-pause: watching lid and power through ${binary}`);

  ctx.on('dispose', () => {
    watcher.stop();
    gate.dispose();
  });
}
