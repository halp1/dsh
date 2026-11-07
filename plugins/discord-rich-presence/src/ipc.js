import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OP_HANDSHAKE = 0;
export const OP_FRAME = 1;
export const OP_CLOSE = 2;
export const OP_PING = 3;
export const OP_PONG = 4;

export function candidateEndpoints() {
  const endpoints = [];
  if (process.platform === 'win32') {
    for (let i = 0; i < 10; i++) {
      endpoints.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    }
    return endpoints;
  }

  const dirs = [];
  if (process.env.TMPDIR) dirs.push(process.env.TMPDIR.replace(/\/+$/, ''));
  if (process.env.XDG_RUNTIME_DIR) dirs.push(process.env.XDG_RUNTIME_DIR.replace(/\/+$/, ''));
  dirs.push('/tmp');

  if (process.platform === 'darwin') {
    dirs.push(join(homedir(), 'Library', 'Application Support', 'discord'));
  } else {
    dirs.push(join(homedir(), '.config', 'discord'));
    if (typeof process.getuid === 'function') {
      dirs.push(`/run/user/${process.getuid()}`);
    }
  }

  const seen = new Set();
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    for (let i = 0; i < 10; i++) {
      endpoints.push(join(dir, `discord-ipc-${i}`));
    }
  }

  return endpoints;
}

export function encodeFrame(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export class DiscordRpcClient {
  constructor(options = {}) {
    this.clientId = options.clientId || '1540732930127691807';
    this.connectTimeoutMs = options.connectTimeoutMs || 3000;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.connected = false;
    this.ready = false;
    this.closed = false;
    this.listeners = new Set();
    this.disconnectListeners = new Set();
    this.pingTimer = null;
  }

  onDisconnect(listener) {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  isConnected() {
    return this.connected && this.ready;
  }

  async connect() {
    if (this.closed) throw new Error('Client is closed');
    const endpoints = candidateEndpoints();
    for (const endpoint of endpoints) {
      if (this.closed) break;
      try {
        await this._connectOne(endpoint);
        return;
      } catch {
        // Continue to the next endpoint
      }
    }
    throw new Error('Unable to connect to any Discord IPC endpoint');
  }

  _connectOne(endpoint) {
    return new Promise((resolve, reject) => {
      const socket = connect(endpoint);
      this.socket = socket;
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        this.socket = null;
        reject(err);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        this.connected = true;
        resolve();
      };

      socket.setTimeout(this.connectTimeoutMs);
      socket.once('timeout', () => fail(new Error(`Connect timeout on ${endpoint}`)));
      socket.once('error', (err) => fail(err));
      socket.once('close', () => {
        if (!settled) fail(new Error(`Socket closed before handshake on ${endpoint}`));
        else this._handleClose();
      });

      socket.on('data', (chunk) => this._onData(chunk));

      this._write(OP_HANDSHAKE, {
        v: 1,
        client_id: this.clientId,
      });

      this._waitForReady(3000).then(() => {
        this.ready = true;
        succeed();
        this._startPing();
      }).catch((err) => fail(err));
    });
  }

  _waitForReady(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error('Timeout waiting for READY handshake'));
      }, timeoutMs);

      const listener = (msg) => {
        if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(msg);
        }
      };
      this.listeners.add(listener);
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (this.buffer.length < 8 + length) break;
      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      let message;
      try {
        message = JSON.parse(body.toString('utf8'));
      } catch {
        continue;
      }
      this._dispatch(opcode, message);
    }
  }

  _dispatch(opcode, message) {
    if (opcode === OP_PING) {
      this._write(OP_PONG, {});
      return;
    }
    if (opcode === OP_CLOSE) {
      this._handleClose();
      return;
    }

    if (message?.nonce && this.pending.has(message.nonce)) {
      const resolve = this.pending.get(message.nonce);
      this.pending.delete(message.nonce);
      resolve(message);
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch {
        // Ignore listener errors
      }
    }
  }

  _write(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(encodeFrame(opcode, payload));
  }

  request(cmd, args, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected to Discord'));
        return;
      }
      const nonce = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`Timeout waiting for ${cmd}`));
      }, timeoutMs);

      this.pending.set(nonce, (message) => {
        clearTimeout(timer);
        if (message.evt === 'ERROR') {
          reject(new Error(`${cmd} failed: ${message.data?.message || 'unknown error'}`));
        } else {
          resolve(message);
        }
      });

      this._write(OP_FRAME, { cmd, args, nonce });
    });
  }

  async setActivity(activity) {
    if (!this.isConnected()) return false;
    try {
      await this.request('SET_ACTIVITY', {
        pid: process.pid,
        activity,
      });
      return true;
    } catch {
      return false;
    }
  }

  async clearActivity() {
    if (!this.isConnected()) return false;
    try {
      await this.request('SET_ACTIVITY', {
        pid: process.pid,
        activity: null,
      });
      return true;
    } catch {
      return false;
    }
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.connected) this._write(OP_PING, {});
    }, 15000);
    if (typeof this.pingTimer.unref === 'function') {
      this.pingTimer.unref();
    }
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _handleClose() {
    const wasConnected = this.connected;
    this.connected = false;
    this.ready = false;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    for (const resolve of this.pending.values()) {
      try {
        resolve({ evt: 'ERROR', data: { message: 'Transport closed' } });
      } catch {
        // Ignore
      }
    }
    this.pending.clear();
    this._stopPing();
    if (wasConnected) {
      for (const listener of this.disconnectListeners) {
        try {
          listener();
        } catch {
          // Ignore
        }
      }
    }
  }

  close() {
    this.closed = true;
    this._stopPing();
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // Ignore
      }
      this.socket = null;
    }
    this.connected = false;
    this.ready = false;
  }
}
