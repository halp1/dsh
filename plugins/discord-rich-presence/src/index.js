import { basename } from 'node:path';
import { DiscordRpcClient } from './ipc.js';

export const name = 'discord-rich-presence';
export const inject = ['fs'];

const DEFAULT_STATUSES = {
  idle: ['Waiting for instructions'],
  agentWorking: ['Thinking and coding', 'Executing turn'],
  tools: ['Editing files', 'Running commands'],
  userInput: ['Reviewing user request'],
};

export function resolveConfig(raw = {}) {
  const optionalString = (key, fallback) => {
    const val = raw[key];
    if (val === undefined || val === null || val === '') return fallback;
    if (typeof val !== 'string') throw new Error(`discord-rich-presence: ${key} must be a string`);
    return val;
  };

  const optionalNumber = (key, fallback) => {
    const val = raw[key];
    if (val === undefined || val === null) return fallback;
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
      throw new Error(`discord-rich-presence: ${key} must be a positive number`);
    }
    return val;
  };

  const statuses = raw.statuses || {};

  return Object.freeze({
    enabled: raw.enabled ?? true,
    clientId: optionalString('clientId', '1540732930127691807'),
    details: optionalString('details', 'DeepSeek Harness'),
    largeImage: optionalString('largeImage', ''),
    largeText: optionalString('largeText', 'DeepSeek Harness'),
    showFile: raw.showFile ?? true,
    minIntervalMs: optionalNumber('minIntervalMs', 3000),
    reconnectMs: optionalNumber('reconnectMs', 15000),
    statuses: Object.freeze({
      idle: Array.isArray(statuses.idle) && statuses.idle.length > 0 ? statuses.idle : DEFAULT_STATUSES.idle,
      agentWorking: Array.isArray(statuses.agentWorking) && statuses.agentWorking.length > 0 ? statuses.agentWorking : DEFAULT_STATUSES.agentWorking,
      tools: Array.isArray(statuses.tools) && statuses.tools.length > 0 ? statuses.tools : DEFAULT_STATUSES.tools,
      userInput: Array.isArray(statuses.userInput) && statuses.userInput.length > 0 ? statuses.userInput : DEFAULT_STATUSES.userInput,
    }),
  });
}

export function formatActivity(state, config, activeFile, sessionStartTime) {
  let details = config.details;
  if (config.showFile && activeFile) {
    details = `Editing ${activeFile}`;
  }

  const activity = {
    state,
    details,
    timestamps: {
      start: sessionStartTime,
    },
  };

  if (config.largeImage) {
    activity.assets = {
      large_image: config.largeImage,
      large_text: config.largeText,
    };
  }

  return activity;
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const logger = ctx.logger('discord-rich-presence');

  if (!config.enabled) {
    logger.info('discord-rich-presence: disabled by config');
    return;
  }

  const rpc = new DiscordRpcClient({
    clientId: config.clientId,
  });

  let currentPhase = 'idle';
  let activeFile = null;
  let lastPushTime = 0;
  let lastPayloadKey = '';
  let pushTimer = null;
  let reconnectTimer = null;
  let sessionStartTime = Math.floor(Date.now() / 1000);
  let isDisposed = false;

  const cursors = {
    idle: 0,
    agentWorking: 0,
    tools: 0,
    userInput: 0,
  };

  function getStatusLine(phase) {
    const list = config.statuses[phase] || DEFAULT_STATUSES[phase] || ['Active'];
    const idx = cursors[phase] % list.length;
    cursors[phase] = (cursors[phase] + 1) % list.length;
    return list[idx];
  }

  async function pushActivity() {
    if (isDisposed || !rpc.isConnected()) return;

    const state = getStatusLine(currentPhase);
    const activity = formatActivity(state, config, activeFile, sessionStartTime);
    const key = `${activity.state}|${activity.details}`;

    const now = Date.now();
    if (key === lastPayloadKey && now - lastPushTime < config.minIntervalMs) {
      return;
    }

    lastPushTime = now;
    lastPayloadKey = key;

    try {
      await rpc.setActivity(activity);
    } catch (err) {
      logger.warn(`discord-rich-presence: failed to set activity: ${err?.message || err}`);
    }
  }

  function schedulePush() {
    if (pushTimer || isDisposed) return;
    const elapsed = Date.now() - lastPushTime;
    const delay = elapsed >= config.minIntervalMs ? 100 : config.minIntervalMs - elapsed;

    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushActivity().catch(() => {});
    }, delay);
  }

  function connectToDiscord() {
    if (isDisposed || rpc.isConnected() || reconnectTimer) return;

    rpc.connect().then(() => {
      logger.info('discord-rich-presence: connected to Discord');
      schedulePush();
    }).catch(() => {
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer || isDisposed) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectToDiscord();
    }, config.reconnectMs);
    if (typeof reconnectTimer.unref === 'function') {
      reconnectTimer.unref();
    }
  }

  rpc.onDisconnect(() => {
    if (isDisposed) return;
    logger.info('discord-rich-presence: disconnected from Discord');
    scheduleReconnect();
  });

  ctx.on('agent/status', (payload) => {
    const status = payload?.status;
    if (status === 'running') {
      currentPhase = 'agentWorking';
    } else {
      currentPhase = 'idle';
    }
    schedulePush();
  }, { global: true });

  ctx.on('agent/inbox/inserted', (payload) => {
    const message = payload?.message;
    if (message?.source?.kind === 'user') {
      currentPhase = 'userInput';
      schedulePush();
    }
  }, { global: true });

  ctx.on('tools/pre-execute', (exec, next) => {
    currentPhase = 'tools';
    schedulePush();
    if (typeof next === 'function') return next();
  }, { global: true });

  ctx.on('fs/observed', (target, observation) => {
    try {
      if (observation?.kind !== 'present') return;
      const entity = ctx.fs.processPath(target);
      if (typeof entity === 'string' && entity.length > 0) {
        activeFile = basename(entity);
        schedulePush();
      }
    } catch {
      // Must not throw in fs/observed
    }
  }, { global: true });

  ctx.on('session/created', () => {
    sessionStartTime = Math.floor(Date.now() / 1000);
    currentPhase = 'agentWorking';
    schedulePush();
  }, { global: true });

  connectToDiscord();

  ctx.on('dispose', () => {
    isDisposed = true;
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    rpc.clearActivity().catch(() => {}).finally(() => {
      rpc.close();
    });
  });
}
