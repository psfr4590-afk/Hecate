'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.HECATE_API_TOKEN = 'server-lifecycle-test-token';

const server = require('./server');

describe('API server lifecycle', () => {
  after(async () => {
    await server.stop();
  });

  it('can start, stop, and start again without stale WebSocket state', async () => {
    const first = await server.start({
      port: 0,
      host: '127.0.0.1',
      wsOrigins: [],
    });
    assert.equal(first.host, '127.0.0.1');
    assert.ok(Number.isInteger(first.port) && first.port > 0);

    await server.stop();

    const second = await server.start({
      port: 0,
      host: '127.0.0.1',
      wsOrigins: [],
    });
    assert.equal(second.host, '127.0.0.1');
    assert.ok(Number.isInteger(second.port) && second.port > 0);

    await server.stop();
  });
});
