'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

process.env.HECATE_API_TOKEN = 'browser-session-test-token';

const auth = require('./middleware/auth');
const { errorHandler } = require('./middleware/error-handler');

describe('Local browser session authentication', () => {
  let server;

  before(async () => {
    const app = express();
    app.get('/bootstrap', (req, res) => {
      res.setHeader('Set-Cookie', auth.sessionSetCookieHeader());
      res.json({ ok: true });
    });
    app.use(auth);
    app.get('/protected', (req, res) => res.json({ operator: req.hecateOperatorId, auth: req.hecateToken }));
    app.use(errorHandler);

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  after(() => server.close());

  function request(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        path,
        headers,
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('mints an HttpOnly SameSite=Strict browser session', async () => {
    const r = await request('/bootstrap');
    assert.equal(r.status, 200);
    const cookie = r.headers['set-cookie']?.[0] ?? '';
    assert.match(cookie, /^hecate_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/);
  });

  it('accepts the minted browser session without exposing the API token', async () => {
    const bootstrap = await request('/bootstrap');
    const cookie = bootstrap.headers['set-cookie'][0].split(';', 1)[0];

    const r = await request('/protected', { Cookie: cookie });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).auth, 'local-session');
  });

  it('rejects a forged browser session', async () => {
    const r = await request('/protected', { Cookie: 'hecate_session=forged.payload' });
    assert.equal(r.status, 401);
  });

  it('continues to accept programmatic bearer authentication', async () => {
    const r = await request('/protected', {
      Authorization: 'Bearer browser-session-test-token',
    });
    assert.equal(r.status, 200);
    assert.match(JSON.parse(r.body).auth, /^browser-/);
  });
});
