'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const handlerPath = require.resolve('./beacon-handler');
const originalHandler = require(handlerPath);
let captured = null;

require.cache[handlerPath].exports = {
  ...originalHandler,
  handle: async opts => {
    captured = opts;
    return { status: 204, body: '' };
  },
};

const { beaconMiddleware } = require('../index');

after(() => {
  require.cache[handlerPath].exports = originalHandler;
  delete require.cache[require.resolve('../index')];
});

test('beacon middleware preserves the raw encrypted wire payload after JSON parsing', async () => {
  captured = null;
  const raw = '  SGVsbG8tQ0MyLXdpcmU=  ';
  const req = {
    headers: { 'x-agent-id': 'implant-test' },
    _hecateRawBody: Buffer.from(raw, 'utf8'),
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
  let statusCode = null;
  let ended = false;
  const res = {
    status(code) { statusCode = code; return this; },
    send() { return this; },
    end() { ended = true; },
  };

  await beaconMiddleware(req, res);

  assert.equal(captured.implantId, 'implant-test');
  assert.equal(captured.rawBody, 'SGVsbG8tQ0MyLXdpcmU=');
  assert.equal(captured.ip, '127.0.0.1');
  assert.equal(statusCode, 204);
  assert.equal(ended, true);
});
