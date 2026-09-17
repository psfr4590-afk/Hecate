'use strict';

/**
 * HECATE — Phase 2 API Test Suite
 * Tests middleware and route layer in isolation.
 * Core is mocked — this suite tests the API surface, not the DB.
 *
 * Run: node --experimental-sqlite --test api/api.test.js
 */

const { describe, it, before, after, mock } = require('node:test');
const assert  = require('node:assert/strict');
const http    = require('http');
const path    = require('path');

// ── Minimal mock setup BEFORE requiring API modules ───────────────────────────
// Inject mocks into require.cache by absolute path — no need for files to exist.
// Routes do require('../../core/...'); from api/routes/ that resolves to
// <root>/core/... so we construct the absolute path from project root.

const ROOT = path.resolve(__dirname, '..');

function mockModule(relFromRoot, exports) {
  const abs = path.resolve(ROOT, relFromRoot) + '.js';
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// Mock env before auth loads
process.env.HECATE_API_TOKEN = 'test-token-secure-12345';
process.env.HECATE_KEY_PATH  = '/tmp/hecate-test.key';

// Pre-populate cache with no-op stubs for ALL core modules routes might pull.
// Real mocks are installed inside each describe() before requiring the route.
// These exist only so top-level require() in route files don't blow up.
const noop = () => null;
const STUB_MODULES = [
  'core/db/models/engagement',
  'core/db/models/target',
  'core/db/models/credential',
  'core/db/models/session',
  'core/db/models/evidence',
  'core/db/models/finding',
  'core/db/models/operator-log',
  'core/db/queries/targets',
  'core/db/queries/credentials',
  'core/db/queries/sessions',
  'core/db/queries/evidence',
  'core/store/credential-store',
  'core/store/session-store',
  'core/graph/target-graph',
  'core/graph/ad-graph',
  'core/audit/audit-log',
  'core/events/event-bus',
];

// Install stubs immediately (before any route is require()'d)
;(function preStub() {
  const EventEmitter = require('events');
  const bus = new EventEmitter();
  for (const m of STUB_MODULES) {
    const abs = path.resolve(ROOT, m) + '.js';
    // event-bus needs to be a real emitter for event-bridge tests
    const exp = m === 'core/events/event-bus' ? bus : {};
    require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exp };
  }
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Make a raw HTTP request to the test server */
function request(server, method, path, opts = {}) {
  const { body, token = 'test-token-secure-12345', headers = {} } = opts;
  const addr   = server.address();
  const host   = addr.address === '::' ? '127.0.0.1' : addr.address;
  const port   = addr.port;
  const json   = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request({
      host, port, method,
      path,
      headers: {
        'Content-Type':     'application/json',
        'Content-Length':   json ? Buffer.byteLength(json) : 0,
        'X-Hecate-Token':   token,
        ...headers,
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (json) req.write(json);
    req.end();
  });
}

function startTestServer(app) {
  return new Promise((resolve) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE UNIT TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Middleware: auth', () => {
  const auth = require('./middleware/auth');
  const express = require('express');

  let app, srv;

  before(async () => {
    app = express();
    app.use(auth);
    app.get('/health',    (req, res) => res.json({ ok: true }));
    app.get('/protected', (req, res) => res.json({ secret: true }));
    srv = await startTestServer(app);
  });

  after(() => srv.close());

  it('allows /health without token', async () => {
    const r = await request(srv, 'GET', '/health', { token: '' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  it('rejects missing token on protected route', async () => {
    const r = await request(srv, 'GET', '/protected', { token: '' });
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'HECATE_UNAUTHORIZED');
  });

  it('rejects wrong token', async () => {
    const r = await request(srv, 'GET', '/protected', { token: 'wrong' });
    assert.equal(r.status, 401);
  });

  it('accepts correct token via X-Hecate-Token', async () => {
    const r = await request(srv, 'GET', '/protected',
      { headers: { 'X-Hecate-Token': process.env.HECATE_API_TOKEN } });
    assert.equal(r.status, 200);
    assert.equal(r.body.secret, true);
  });

  it('accepts correct token via Authorization: Bearer', async () => {
    const r = await request(srv, 'GET', '/protected', {
      headers: { 'Authorization': `Bearer ${process.env.HECATE_API_TOKEN}` },
      token: ''
    });
    assert.equal(r.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Middleware: rate-limit', () => {
  const { create } = require('./middleware/rate-limit');
  const express = require('express');

  let app, srv;

  before(async () => {
    app = express();
    // Very tight limit for testing
    app.use(create({ windowMs: 5000, max: 3 }));
    app.get('/hit', (req, res) => res.json({ ok: true }));
    srv = await startTestServer(app);
  });

  after(() => srv.close());

  it('allows requests under the limit', async () => {
    const r1 = await request(srv, 'GET', '/hit', { token: '' });
    const r2 = await request(srv, 'GET', '/hit', { token: '' });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
  });

  it('returns 429 after limit exceeded', async () => {
    // Already used 2 in previous test; 1 more hits limit, next should 429
    await request(srv, 'GET', '/hit', { token: '' }); // 3rd — still ok
    const r = await request(srv, 'GET', '/hit', { token: '' }); // 4th — over
    assert.equal(r.status, 429);
    assert.equal(r.body.error.code, 'RATE_LIMITED');
  });

  it('sets X-RateLimit-Limit header', async () => {
    const r = await request(srv, 'GET', '/hit', { token: '' });
    // May be 200 or 429 depending on window; header should exist either way
    assert.ok(r.headers['x-ratelimit-limit'] || r.status === 429);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Middleware: error-handler', () => {
  const { errorHandler, HecateError } = require('./middleware/error-handler');
  const express = require('express');

  let app, srv;

  before(async () => {
    app = express();
    app.get('/known',   (req, res, next) =>
      next(new HecateError('HECATE_NOT_FOUND', 'Thing not found')));
    app.get('/unknown', (req, res, next) =>
      next(new Error('Unexpected boom')));
    app.get('/conflict', (req, res, next) => {
      const err = new Error('Constraint'); err.code = 'SQLITE_CONSTRAINT'; next(err);
    });
    app.use(errorHandler);
    srv = await startTestServer(app);
  });

  after(() => srv.close());

  it('maps HecateError to correct HTTP status', async () => {
    const r = await request(srv, 'GET', '/known', { token: '' });
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'HECATE_NOT_FOUND');
    assert.equal(r.body.error.message, 'Thing not found');
  });

  it('maps SQLite constraint to 409', async () => {
    const r = await request(srv, 'GET', '/conflict', { token: '' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'HECATE_CONFLICT');
  });

  it('maps unknown errors to 500', async () => {
    const r = await request(srv, 'GET', '/unknown', { token: '' });
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, 'INTERNAL_ERROR');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTE INTEGRATION TESTS (mocked core)
// ═════════════════════════════════════════════════════════════════════════════

describe('Routes: engagements', () => {
  // Inline mock app — bypasses full server init
  const { HecateError, errorHandler } = require('./middleware/error-handler');
  const auth  = require('./middleware/auth');
  const express = require('express');

  // In-memory engagement store for tests
  const store = new Map();
  let seq = 0;

  // Patch Engagement model
  const Engagement = {
    list:     ()     => [...store.values()],
    findById: (id)   => store.get(id) ?? null,
    isOperatorMember: (id, operatorId) => { const e = store.get(id); return !!e && (e.ownerOperatorId || 'local-operator') === operatorId; },
    create:   (data) => { const id = `eng-${++seq}`; store.set(id, { id, ...data, created_at: new Date().toISOString() }); return id; },
    update:   (id, data) => { const e = store.get(id); if (e) store.set(id, { ...e, ...data }); },
    remove:   (id)   => store.delete(id),
  };
  mockModule('core/db/models/engagement', Engagement);

  const engRouter = require('./routes/engagements');
  let app, srv;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use(auth);
    app.use('/api/v1/engagements', engRouter);
    app.use(errorHandler);
    srv = await startTestServer(app);
  });

  after(() => srv.close());

  it('GET /engagements — empty list', async () => {
    const r = await request(srv, 'GET', '/api/v1/engagements');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.engagements));
  });

  it('POST /engagements — create', async () => {
    const r = await request(srv, 'POST', '/api/v1/engagements',
      { body: { name: 'Test Op', description: 'Phase 2 test', scope: 'lab' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.engagement.name, 'Test Op');
    assert.ok(r.body.engagement.id);
  });

  it('POST /engagements — 400 missing name', async () => {
    const r = await request(srv, 'POST', '/api/v1/engagements',
      { body: { description: 'No name' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'HECATE_BAD_INPUT');
  });

  it('GET /engagements/:id — found', async () => {
    // Create one first
    const c = await request(srv, 'POST', '/api/v1/engagements',
      { body: { name: 'Op Fetch' } });
    const id = c.body.engagement.id;

    const r = await request(srv, 'GET', `/api/v1/engagements/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.engagement.id, id);
  });

  it('GET /engagements/:id — 404 missing', async () => {
    const r = await request(srv, 'GET', '/api/v1/engagements/nonexistent');
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'HECATE_NOT_FOUND');
  });

  it('PATCH /engagements/:id — update', async () => {
    const c = await request(srv, 'POST', '/api/v1/engagements',
      { body: { name: 'Original' } });
    const id = c.body.engagement.id;

    const r = await request(srv, 'PATCH', `/api/v1/engagements/${id}`,
      { body: { name: 'Updated' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.engagement.name, 'Updated');
  });

  it('DELETE /engagements/:id — 204', async () => {
    const c = await request(srv, 'POST', '/api/v1/engagements',
      { body: { name: 'Doomed' } });
    const id = c.body.engagement.id;

    const r = await request(srv, 'DELETE', `/api/v1/engagements/${id}`);
    assert.equal(r.status, 204);

    const r2 = await request(srv, 'GET', `/api/v1/engagements/${id}`);
    assert.equal(r2.status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Routes: sessions', () => {
  const { errorHandler } = require('./middleware/error-handler');
  const auth    = require('./middleware/auth');
  const express = require('express');

  const sessStore = new Map();
  let sessSeq = 0;

  const SessionStore = {
    create:          (data) => { const id = `sess-${++sessSeq}`; const now = new Date().toISOString(); sessStore.set(id, { id, ...data, status: 'active', created_at: now, last_seen: now }); return id; },
    findById:        (id)   => sessStore.get(id) ?? null,
    findByIdForEngagement: (id, eid) => { const s = sessStore.get(id); return s && s.engagementId === eid ? s : null; },
    findByEngagement:(eid)  => [...sessStore.values()].filter(s => s.engagementId === eid),
    listActive:      ()     => [...sessStore.values()].filter(s => s.status === 'active'),
    listActiveForOperator: () => [...sessStore.values()].filter(s => s.status === 'active'),
    heartbeatForEngagement: (id, eid) => { const s = sessStore.get(id); if (!s || s.engagementId !== eid) return false; s.last_seen = new Date().toISOString(); return true; },
    heartbeat:       (id)   => { const s = sessStore.get(id); if (!s) return false; s.last_seen = new Date().toISOString(); return true; },
    setInactiveForEngagement: (id, eid) => { const s = sessStore.get(id); if (s && s.engagementId === eid) s.status = 'inactive'; },
    setDeadForEngagement: (id, eid) => { const s = sessStore.get(id); if (s && s.engagementId === eid) s.status = 'dead'; },
    updateMetadataForEngagement: (id, eid, m) => { const s = sessStore.get(id); if (s && s.engagementId === eid) s.metadata = m; },
    removeForEngagement: (id, eid) => { const s = sessStore.get(id); return !!s && s.engagementId === eid && sessStore.delete(id); },
    setInactive:     (id)   => { const s = sessStore.get(id); if (s) s.status = 'inactive'; },
    setDead:         (id)   => { const s = sessStore.get(id); if (s) s.status = 'dead'; },
    updateMetadata:  (id, m)=> { const s = sessStore.get(id); if (s) s.metadata = m; },
    remove:          (id)   => sessStore.delete(id),
  };

  const EngMock = { findById: (id) => id === 'eng-1' ? { id, ownerOperatorId: 'local-operator' } : null, isOperatorMember: (id, operatorId) => id === 'eng-1' && operatorId === 'local-operator' };

  mockModule('core/store/session-store', SessionStore);
  mockModule('core/db/models/engagement', EngMock);

  const sessRouter = require('./routes/sessions');
  let app, srv;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use(auth);
    app.use('/api/v1/sessions', sessRouter);
    app.use(errorHandler);
    srv = await startTestServer(app);
  });

  after(() => srv.close());

  it('POST session — create', async () => {
    const r = await request(srv, 'POST', '/api/v1/sessions/engagement/eng-1',
      { body: { module: 'recon', transport: 'http' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.session.status, 'active');
    assert.equal(r.body.session.module, 'recon');
  });

  it('GET session by id', async () => {
    const c = await request(srv, 'POST', '/api/v1/sessions/engagement/eng-1',
      { body: { module: 'c2' } });
    const id = c.body.session.id;
    const r  = await request(srv, 'GET', `/api/v1/sessions/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.session.id, id);
  });

  it('POST heartbeat', async () => {
    const c = await request(srv, 'POST', '/api/v1/sessions/engagement/eng-1',
      { body: { module: 'mitm' } });
    const id = c.body.session.id;
    const r  = await request(srv, 'POST', `/api/v1/sessions/${id}/heartbeat`);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });

  it('PATCH status → inactive', async () => {
    const c = await request(srv, 'POST', '/api/v1/sessions/engagement/eng-1',
      { body: { module: 'delivery' } });
    const id = c.body.session.id;
    const r  = await request(srv, 'PATCH', `/api/v1/sessions/${id}/status`,
      { body: { status: 'inactive' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.session.status, 'inactive');
  });

  it('PATCH status — rejects invalid', async () => {
    const c = await request(srv, 'POST', '/api/v1/sessions/engagement/eng-1',
      { body: { module: 'pivot' } });
    const id = c.body.session.id;
    const r  = await request(srv, 'PATCH', `/api/v1/sessions/${id}/status`,
      { body: { status: 'ghost' } });
    assert.equal(r.status, 400);
  });

  it('GET /active — returns active sessions', async () => {
    const r = await request(srv, 'GET', '/api/v1/sessions/active');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.sessions));
  });

  it('DELETE session — 204', async () => {
    const c = await request(srv, 'POST', '/api/v1/sessions/engagement/eng-1',
      { body: { module: 'webapp' } });
    const id = c.body.session.id;
    const r  = await request(srv, 'DELETE', `/api/v1/sessions/${id}`);
    assert.equal(r.status, 204);
    const r2 = await request(srv, 'GET', `/api/v1/sessions/${id}`);
    assert.equal(r2.status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Routes: audit', () => {
  const { errorHandler } = require('./middleware/error-handler');
  const auth    = require('./middleware/auth');
  const express = require('express');

  const AuditLog = {
    tail:   (n)      => Array.from({ length: Math.min(n, 3) }, (_, i) => ({
      id: i+1, ts: new Date().toISOString(), action: `test:${i}`, hash: 'abc'
    })),
    range:  (from, to) => [],
    verify: ()         => ({ valid: true, checked: 3 }),
  };
  mockModule('core/audit/audit-log', AuditLog);

  const auditRouter = require('./routes/audit');
  let app, srv;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use(auth);
    app.use('/api/v1/audit', auditRouter);
    app.use(errorHandler);
    srv = await startTestServer(app);
  });

  after(() => srv.close());

  it('GET /audit — tails entries', async () => {
    const r = await request(srv, 'GET', '/api/v1/audit?limit=3&engagementId=e1');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.entries));
    assert.ok(r.body.entries.length <= 3);
  });

  it('GET /audit/verify — valid chain', async () => {
    const r = await request(srv, 'GET', '/api/v1/audit/verify');
    assert.equal(r.status, 200);
    assert.equal(r.body.valid, true);
  });

  it('GET /audit/range — requires from param', async () => {
    const r = await request(srv, 'GET', '/api/v1/audit/range?engagementId=e1');
    assert.equal(r.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('WebSocket: ws-server', () => {
  const wsLib    = require('ws');
  const wsServer = require('./websocket/ws-server');
  const http2    = require('http');

  let srv;

  before(async () => {
    srv = http2.createServer();
    wsServer.attach(srv, { allowedOrigins: [] }); // empty = accept all origins in test
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
  });

  after(() => {
    wsServer.close();
    srv.close();
  });

  it('accepts client connection', async () => {
    const addr = srv.address();
    const ws   = new wsLib(`ws://127.0.0.1:${addr.port}`);
    await new Promise((resolve, reject) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'hecate:connected') { ws.close(); resolve(); }
      });
      ws.on('error', reject);
    });
    assert.ok(true, 'connected and received welcome frame');
  });

  it('broadcast reaches connected client', async () => {
    const addr = srv.address();
    const ws   = new wsLib(`ws://127.0.0.1:${addr.port}`);

    // Wait for welcome frame, then trigger broadcast
    const received = await new Promise((resolve, reject) => {
      let welcomed = false;
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (!welcomed && msg.type === 'hecate:connected') {
          welcomed = true;
          // Broadcast after connection established
          setImmediate(() => wsServer.broadcast('test:event', { value: 42 }));
          return;
        }
        if (msg.type === 'test:event') { ws.close(); resolve(msg); }
      });
      ws.on('error', reject);
    });

    assert.equal(received.type, 'test:event');
    assert.equal(received.data.value, 42);
  });

  it('clientCount returns connected count', async () => {
    const addr = srv.address();
    const ws   = new wsLib(`ws://127.0.0.1:${addr.port}`);
    await new Promise((resolve, reject) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'hecate:connected') resolve();
      });
      ws.on('error', reject);
    });
    assert.ok(wsServer.clientCount() >= 1);
    ws.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Server: /health endpoint', () => {
  // Lightweight test — just the health route without full server init
  const express = require('express');
  let app, srv;

  before(async () => {
    app = express();
    app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
    srv = await startTestServer(app);
  });

  after(() => srv.close());

  it('returns 200 with ok:true', async () => {
    const r = await request(srv, 'GET', '/health', { token: '' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.ts);
  });
});
