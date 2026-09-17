'use strict';

/** HECATE — Phase 1 core authorization/scoping tests. */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(os.tmpdir(), `hecate-auth-core-${Date.now()}.db`);
const Database = require('./db/database');
Database.init({ path: DB_PATH });

const Engagement = require('./db/models/engagement');
const Target = require('./db/models/target');
const Evidence = require('./db/models/evidence');
const Finding = require('./db/models/finding');
const SessionStore = require('./store/session-store');

before(() => {});
after(() => { Database.close(); try { fs.unlinkSync(DB_PATH); } catch {} });

describe('Phase 1: membership and scoped data access', () => {
  let a, b, targetA, evidenceA, findingA, sessionA;

  it('creates owner memberships', () => {
    a = Engagement.create({ name: 'A', ownerOperatorId: 'operator-a' });
    b = Engagement.create({ name: 'B', ownerOperatorId: 'operator-b' });
    assert.equal(Engagement.isOperatorMember(a, 'operator-a'), true);
    assert.equal(Engagement.isOperatorMember(a, 'operator-b'), false);
    assert.equal(Engagement.isOperatorMember(b, 'operator-b'), true);
  });

  it('lists only operator-owned engagements when scoped', () => {
    assert.deepEqual(Engagement.list('operator-a').map(x => x.id), [a]);
    assert.deepEqual(Engagement.list('operator-b').map(x => x.id), [b]);
  });

  it('scopes target lookup by engagement', () => {
    targetA = Target.upsert({ engagementId: a, type: 'host', value: 'target-a' });
    assert.ok(Target.findById(targetA));
    assert.ok(Target.findByIdForEngagement(targetA, a));
    assert.equal(Target.findByIdForEngagement(targetA, b), null);
  });

  it('scopes evidence and findings by engagement', () => {
    evidenceA = Evidence.create({ engagementId: a, type: 'test', module: 'test', targetId: targetA });
    findingA = Finding.create({ engagementId: a, title: 'Test', severity: 'low', targetId: targetA });
    assert.ok(Evidence.findByIdForEngagement(evidenceA, a));
    assert.equal(Evidence.findByIdForEngagement(evidenceA, b), null);
    assert.ok(Finding.findByIdForEngagement(findingA, a));
    assert.equal(Finding.findByIdForEngagement(findingA, b), null);
  });

  it('scopes sessions by engagement', () => {
    sessionA = SessionStore.create({ engagementId: a, module: 'test', targetId: targetA });
    assert.ok(SessionStore.findByIdForEngagement(sessionA, a));
    assert.equal(SessionStore.findByIdForEngagement(sessionA, b), null);
    assert.equal(SessionStore.listActiveForOperator('operator-a').length, 1);
    assert.equal(SessionStore.listActiveForOperator('operator-b').length, 0);
  });

  it('supports membership grants without exposing resource data', () => {
    assert.equal(Engagement.addOperator(a, 'operator-b', 'operator'), true);
    assert.equal(Engagement.isOperatorMember(a, 'operator-b'), true);
  });
});
