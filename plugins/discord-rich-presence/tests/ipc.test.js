import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import {
  OP_HANDSHAKE,
  OP_FRAME,
  OP_PING,
  OP_PONG,
  OP_CLOSE,
  encodeFrame,
  candidateEndpoints,
  DiscordRpcClient,
} from '../src/ipc.js';

test('encodeFrame serializes little-endian header and UTF-8 json payload', () => {
  const payload = { hello: 'world', count: 42 };
  const frame = encodeFrame(OP_FRAME, payload);

  assert.equal(frame.readUInt32LE(0), OP_FRAME);
  const length = frame.readUInt32LE(4);
  const parsed = JSON.parse(frame.subarray(8, 8 + length).toString('utf8'));
  assert.deepEqual(parsed, payload);
});

test('candidateEndpoints returns non-empty list of paths without duplicates', () => {
  const endpoints = candidateEndpoints();
  assert.ok(Array.isArray(endpoints));
  assert.ok(endpoints.length > 0);
  const unique = new Set(endpoints);
  assert.equal(unique.size, endpoints.length);
});

test('DiscordRpcClient connects, completes handshake, and updates activity over mock IPC socket', async () => {
  const socketPath = join(tmpdir(), `test-discord-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  try {
    unlinkSync(socketPath);
  } catch {
    // Ignore if file does not exist
  }

  const receivedFrames = [];
  const server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const op = buf.readUInt32LE(0);
        const len = buf.readUInt32LE(4);
        if (buf.length < 8 + len) break;
        const body = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'));
        buf = buf.subarray(8 + len);
        receivedFrames.push({ op, body });

        if (op === OP_HANDSHAKE) {
          const readyFrame = encodeFrame(OP_FRAME, {
            cmd: 'DISPATCH',
            data: { v: 1, user: { username: 'testuser' } },
            evt: 'READY',
            nonce: null,
          });
          sock.write(readyFrame);
        } else if (op === OP_FRAME && body.cmd === 'SET_ACTIVITY') {
          const ackFrame = encodeFrame(OP_FRAME, {
            cmd: 'SET_ACTIVITY',
            data: body.args.activity,
            evt: null,
            nonce: body.nonce,
          });
          sock.write(ackFrame);
        } else if (op === OP_PING) {
          sock.write(encodeFrame(OP_PONG, {}));
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(socketPath, resolve));

  const client = new DiscordRpcClient({
    clientId: 'test-app-id',
    connectTimeoutMs: 1000,
  });

  try {
    await client._connectOne(socketPath);
    assert.equal(client.isConnected(), true);

    const activity = {
      state: 'Unit testing',
      details: 'dsh-plugin-discord-rich-presence',
    };
    const setSuccess = await client.setActivity(activity);
    assert.equal(setSuccess, true);

    assert.equal(receivedFrames.length, 2);
    assert.equal(receivedFrames[0].op, OP_HANDSHAKE);
    assert.equal(receivedFrames[0].body.client_id, 'test-app-id');
    assert.equal(receivedFrames[1].op, OP_FRAME);
    assert.equal(receivedFrames[1].body.cmd, 'SET_ACTIVITY');
    assert.deepEqual(receivedFrames[1].body.args.activity, activity);

    const clearSuccess = await client.clearActivity();
    assert.equal(clearSuccess, true);
    assert.equal(receivedFrames.length, 3);
    assert.equal(receivedFrames[2].body.args.activity, null);
  } finally {
    client.close();
    server.close();
    try {
      unlinkSync(socketPath);
    } catch {
      // Ignore
    }
  }
});
