'use strict';

/**
 * Phase 4 API boundary tests.
 * Verifies that the real server protects /api/v1 and that the intentionally
 * public health endpoint remains available. No secret material is exposed.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

process.env.HECATE_API_TOKEN = 'phase4-test-token';
process.env.HECATE_OPERATOR_ID = 'phase4-operator';

const server = require('./server');
const Database = require('../core/db/database');

Database.init({ path: ':memory:' });

const request = supertest(server.app);

before(() => {
  // server.app is intentionally used without binding a TCP port.
});

after(() => {
  Database.close();
});

describe('Phase 4: API authentication boundary', () => {
  it('keeps health public', async () => {
    const res = await request.get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('rejects unauthenticated /api/v1 access', async () => {
    const res = await request.get('/api/v1/status');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'HECATE_UNAUTHORIZED');
  });

  it('accepts authenticated /api/v1 access', async () => {
    const res = await request
      .get('/api/v1/status')
      .set('Authorization', 'Bearer phase4-test-token');
    assert.equal(res.status, 200);
    assert.equal(res.body.platform, 'HECATE');
  });

  it('rejects WebSocket authentication tokens in query strings', () => {
    const { extractToken } = require('./websocket/ws-server');
    assert.equal(extractToken({ headers: {}, url: '/?token=phase4-test-token' }), null);
    assert.equal(extractToken({ headers: { authorization: 'Bearer phase4-test-token' }, url: '/?token=wrong' }), 'phase4-test-token');
  });
});
