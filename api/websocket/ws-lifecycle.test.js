'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');

process.env.HECATE_API_TOKEN = process.env.HECATE_API_TOKEN || 'ws-test-token';

const wsServer = require('./ws-server');

let server;

before(async () => {
  server = http.createServer();
  wsServer.attach(server, { allowedOrigins: [] });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
});

after(async () => {
  await wsServer.close();
  await new Promise(resolve => server.close(() => resolve()));
});

describe('WebSocket lifecycle', () => {
  it('authenticates and fully tears down connected clients', async () => {
    const { port } = server.address();
    const client = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { Authorization: `Bearer ${process.env.HECATE_API_TOKEN}` },
    });

    await new Promise((resolve, reject) => {
      client.once('error', reject);
      client.on('message', raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'hecate:connected') resolve();
      });
    });

    assert.equal(wsServer.clientCount(), 1);
    await wsServer.close();
    assert.equal(wsServer.clientCount(), 0);
    assert.equal(client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING, true);
  });
});
