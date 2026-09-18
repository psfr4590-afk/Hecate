'use strict';

/**
 * HECATE — authorization integration tests.
 *
 * HECATE is intentionally single-operator per process. HTTP requests always
 * authenticate as the immutable configured process principal. Cross-operator
 * isolation is therefore modeled at the database boundary by creating a
 * foreign-owned engagement directly, then exercising the REST API only as
 * the configured operator.
 *
 * No secret material is created or retrieved by these tests.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.HECATE_API_TOKEN = 'phase1-test-token';
process.env.HECATE_OPERATOR_ID = 'operator-a';

const DB_PATH = path.join(os.tmpdir(), `hecate-phase1-${Date.now()}.db`);
const Database = require('../core/db/database');
Database.init({ path: DB_PATH });

const Engagement = require('../core/db/models/engagement');
const Target = require('../core/db/models/target');
const SessionStore = require('../core/store/session-store');
const Evidence = require('../core/db/models/evidence');
const Finding = require('../core/db/models/finding');

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

function request(method, url, body) {
  const json = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      method,
      path: url,
      headers: {
        'Content-Type': 'application/json',
        'X-Hecate-Token': process.env.HECATE_API_TOKEN,
        'Content-Length': json ? Buffer.byteLength(json) : 0,
      },
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
  let engagementA;
  let engagementB;
  let targetA;
  let targetB;
  let sessionA;
  let evidenceA;
  let findingA;
  let sessionB;
  let evidenceB;
  let findingB;

  it('creates the HTTP operator engagement and a foreign engagement at the model boundary', async () => {
    let r = await request('POST', '/engagements', { name: 'A' });
    assert.equal(r.status, 201);
    engagementA = r.body.engagement.id;

    engagementB = Engagement.create({
      name: 'B',
      ownerOperatorId: 'operator-b',
      status: 'active',
    });
    assert.ok(engagementB);
    assert.equal(Engagement.isOperatorMember(engagementA, 'operator-a'), true);
    assert.equal(Engagement.isOperatorMember(engagementB, 'operator-b'), true);
  });

  it('lists only engagements owned by the configured operator', async () => {
    const r = await request('GET', '/engagements');
    assert.equal(r.status, 200);
    assert.ok(r.body.engagements.some(e => e.id === engagementA));
    assert.ok(!r.body.engagements.some(e => e.id === engagementB));
  });

  it('denies cross-engagement access to engagement records', async () => {
    const r = await request('GET', `/engagements/${engagementB}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'HECATE_FORBIDDEN');
  });

  it('denies cross-engagement resource creation', async () => {
    const r = await request('POST', `/targets/engagement/${engagementB}`, {
      type: 'host',
      value: 'target-b-created-through-wrong-engagement',
    });
    assert.equal(r.status, 403);
  });

  it('prevents resource ID substitution across engagements', async () => {
    targetB = Target.upsert({
      engagementId: engagementB,
      type: 'host',
      value: 'target-b',
    });
    assert.ok(targetB);

    const r = await request('GET', `/targets/${targetB}`);
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'HECATE_FORBIDDEN');
  });

  it('keeps resource creation scoped to the owning engagement', async () => {
    let r = await request('POST', `/targets/engagement/${engagementA}`, {
      type: 'host',
      value: 'target-a',
    });
    assert.equal(r.status, 201);
    targetA = r.body.target.id;

    r = await request('POST', `/sessions/engagement/${engagementA}`, {
      module: 'recon',
      targetId: targetA,
    });
    assert.equal(r.status, 201);
    sessionA = r.body.session.id;

    r = await request('POST', `/evidence/engagement/${engagementA}`, {
      type: 'recon:url',
      module: 'recon',
      targetId: targetA,
    });
    assert.equal(r.status, 201);
    evidenceA = r.body.evidence.id;

    r = await request('POST', `/findings/engagement/${engagementA}`, {
      title: 'Test finding',
      severity: 'low',
      targetId: targetA,
    });
    assert.equal(r.status, 201);
    findingA = r.body.finding.id;

    // Foreign resources are created directly at the model boundary so the
    // HTTP principal remains the configured operator-a.
    sessionB = SessionStore.create({
      engagementId: engagementB,
      module: 'recon',
      targetId: targetB,
    });
    evidenceB = Evidence.create({
      engagementId: engagementB,
      type: 'recon:url',
      module: 'recon',
      targetId: targetB,
    });
    findingB = Finding.create({
      engagementId: engagementB,
      title: 'Foreign finding',
      severity: 'low',
      targetId: targetB,
    });
  });

  it('denies cross-engagement access to foreign target/session/evidence/finding IDs', async () => {
    for (const url of [
      `/targets/${targetB}`,
      `/sessions/${sessionB}`,
      `/evidence/${evidenceB}`,
      `/findings/${findingB}`,
    ]) {
      const r = await request('GET', url);
      assert.equal(r.status, 403, url);
      assert.equal(r.body.error.code, 'HECATE_FORBIDDEN', url);
    }
  });

  it('rejects a target from another engagement when attached to a resource', async () => {
    const r = await request('POST', `/sessions/engagement/${engagementA}`, {
      module: 'recon',
      targetId: targetB,
    });
    assert.equal(r.status, 404);
  });

  it('allows the configured operator to modify and delete owned resources', async () => {
    let r = await request('PATCH', `/targets/${targetA}`, { status: 'compromised' });
    assert.equal(r.status, 200);

    r = await request('DELETE', `/findings/${findingA}`);
    assert.equal(r.status, 204);

    r = await request('DELETE', `/evidence/${evidenceA}`);
    assert.equal(r.status, 204);

    r = await request('DELETE', `/sessions/${sessionA}`);
    assert.equal(r.status, 204);
  });
});
