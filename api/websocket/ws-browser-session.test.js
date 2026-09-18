'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');

process.env.HECATE_API_TOKEN = 'browser-session-ws-token';

const auth = require('../middleware/auth');
const wsServer = require('./ws-server');

describe('WebSocket: local browser session', () => {
  let server;

  before(async () => {
    server = http.createServer();
    wsServer.attach(server, { allowedOrigins: ['http://127.0.0.1:7331'] });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    await wsServer.close();
    await new Promise(resolve => server.close(resolve));
  });

  it('accepts the HttpOnly browser session cookie', async () => {
    const cookie = auth.sessionSetCookieHeader().split(';', 1)[0];
    const port = server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: {
        Cookie: cookie,
        Origin: 'http://127.0.0.1:7331',
      },
    });

    await new Promise((resolve, reject) => {
      ws.on('message', raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'hecate:connected') {
          ws.once('close', resolve);
          ws.close();
        }
      });
      ws.on('error', reject);
    });

    assert.equal(ws.readyState, WebSocket.CLOSED);
  });

  it('still rejects unauthenticated browser connections', async () => {
    const port = server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { Origin: 'http://127.0.0.1:7331' },
    });

    const code = await new Promise((resolve, reject) => {
      ws.on('close', (status) => resolve(status));
      ws.on('error', reject);
    });

    assert.equal(code, 1008);
  });
});
