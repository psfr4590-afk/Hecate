'use strict';

/**
 * HECATE — Phase 1 authorization integration tests.
 * Uses the real SQLite core and REST routes. No secret material is created
 * or retrieved by these tests.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.HECATE_API_TOKEN = 'phase1-test-token';

const DB_PATH = path.join(os.tmpdir(), `hecate-phase1-${Date.now()}.db`);
const Database = require('../core/db/database');
Database.init({ path: DB_PATH });

const express = require('express');
const auth = require('./middleware/auth');
const { errorHandler } = require('./middleware/error-handler');
const engagements = require('./routes/engagements');
const targets = require('./routes/targets');
const sessions = require('./routes/sessions');
const evidence = require('./routes/evidence');
const findings = require('./routes/findings');

const app = express();
app.use(express.json());
app.use(auth);
app.use('/engagements', engagements);
app.use('/targets', targets);
app.use('/sessions', sessions);
app.use('/evidence', evidence);
app.use('/findings', findings);
app.use(errorHandler);

let server;

function request(method, url, operator, body) {
  const json = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method, path: url,
      headers: {
        'Content-Type': 'application/json',
        'X-Hecate-Token': process.env.HECATE_API_TOKEN,
        'Content-Length': json ? Buffer.byteLength(json) : 0,
        'X-Test-Operator': operator,
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (json) req.write(json);
    req.end();
  });
}

// The production auth middleware gets the operator from HECATE_OPERATOR_ID.
// Set it per request through a tiny test-only wrapper after auth.
app._router.stack.splice(2, 0, { handle(req, _res, next) {
  if (req.headers['x-test-operator']) req.hecateOperatorId = req.headers['x-test-operator'];
  next();
}, route: undefined });

before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
});

after(() => {
  server.close();
  Database.close();
  try { fs.unlinkSync(DB_PATH); } catch {}
});

describe('Phase 1: engagement authorization', () => {
  let engagementA, engagementB, targetA, sessionA, evidenceA, findingA;

  it('creates separate engagements owned by separate operators', async () => {
    let r = await request('POST', '/engagements', 'operator-a', { name: 'A' });
    assert.equal(r.status, 201); engagementA = r.body.engagement.id;
    r = await request('POST', '/engagements', 'operator-b', { name: 'B' });
    assert.equal(r.status, 201); engagementB = r.body.engagement.id;
  });

  it('lists only engagements owned by the operator', async () => {
    const r = await request('GET', '/engagements', 'operator-a');
    assert.equal(r.status, 200);
    assert.ok(r.body.engagements.some(e => e.id === engagementA));
    assert.ok(!r.body.engagements.some(e => e.id === engagementB));
  });

  it('denies cross-engagement access to engagement records', async () => {
    const r = await request('GET', `/engagements/${engagementB}`, 'operator-a');
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'HECATE_FORBIDDEN');
  });

  it('denies cross-engagement resource creation', async () => {
    const r = await request('POST', `/targets/engagement/${engagementB}`, 'operator-a', { type: 'host', value: 'target-b' });
    assert.equal(r.status, 403);
  });

  it('prevents resource ID substitution across engagements', async () => {
    let r = await request('POST', `/targets/engagement/${engagementB}`, 'operator-b', { type: 'host', value: 'target-b' });
    assert.equal(r.status, 201);
    const targetB = r.body.target.id;
    r = await request('GET', `/targets/${targetB}`, 'operator-a');
    assert.equal(r.status, 403);
  });

  it('keeps resource creation scoped to the owning engagement', async () => {
    let r = await request('POST', `/targets/engagement/${engagementA}`, 'operator-a', { type: 'host', value: 'target-a' });
    assert.equal(r.status, 201); targetA = r.body.target.id;
    r = await request('POST', `/sessions/engagement/${engagementA}`, 'operator-a', { module: 'recon', targetId: targetA });
    assert.equal(r.status, 201); sessionA = r.body.session.id;
    r = await request('POST', `/evidence/engagement/${engagementA}`, 'operator-a', { type: 'recon:url', module: 'recon', targetId: targetA });
    assert.equal(r.status, 201); evidenceA = r.body.evidence.id;
    r = await request('POST', `/findings/engagement/${engagementA}`, 'operator-a', { title: 'Test finding', severity: 'low', targetId: targetA });
    assert.equal(r.status, 201); findingA = r.body.finding.id;
  });

  it('denies cross-engagement access to target/session/evidence/finding IDs', async () => {
    for (const url of [`/targets/${targetA}`, `/sessions/${sessionA}`, `/evidence/${evidenceA}`, `/findings/${findingA}`]) {
      const r = await request('GET', url, 'operator-b');
      assert.equal(r.status, 403, url);
    }
  });

  it('rejects a target from another engagement when attached to a resource', async () => {
    const r = await request('POST', `/sessions/engagement/${engagementA}`, 'operator-a', { module: 'recon', targetId: 'not-a-target-in-A' });
    assert.equal(r.status, 404);
  });

  it('allows the owner to modify and delete owned resources', async () => {
    let r = await request('PATCH', `/targets/${targetA}`, 'operator-a', { status: 'compromised' });
    assert.equal(r.status, 200);
    r = await request('DELETE', `/findings/${findingA}`, 'operator-a');
    assert.equal(r.status, 204);
    r = await request('DELETE', `/evidence/${evidenceA}`, 'operator-a');
    assert.equal(r.status, 204);
    r = await request('DELETE', `/sessions/${sessionA}`, 'operator-a');
    assert.equal(r.status, 204);
  });
});
