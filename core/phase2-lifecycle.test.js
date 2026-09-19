'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DB_PATH = path.join(os.tmpdir(), `hecate-phase2-${process.pid}-${Date.now()}.db`);
const Database = require('./db/database');
const Engagement = require('./db/models/engagement');
const Target = require('./db/models/target');
const Evidence = require('./db/models/evidence');
const Finding = require('./db/models/finding');
const SessionStore = require('./store/session-store');
const AuditLog = require('./audit/audit-log');
const eventBridge = require('../api/websocket/event-bridge');

before(() => { Database.init({ path: DB_PATH }); eventBridge.start(); });
after(() => { try { eventBridge.stop(); } catch {} try { Database.close(); } catch {} for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(DB_PATH+s); } catch {} });

test('Phase 2 lifecycle persists one engagement lineage through audit', () => {
  const eid = Engagement.create({ name: 'Phase 2 lifecycle', ownerOperatorId: 'local-operator' });
  const tid = Target.upsert({ engagementId: eid, type: 'host', value: '127.0.0.1', label: 'local target' });
  const sid = SessionStore.create({ engagementId: eid, module: 'recon', targetId: tid, transport: 'local' });
  const evidenceId = Evidence.create({ engagementId: eid, type: 'observation', module: 'recon', targetId: tid, label: 'test evidence', data: 'bounded test data' });
  const findingId = Finding.create({ engagementId: eid, title: 'Phase 2 test finding', severity: 'low', module: 'recon', targetId: tid, description: 'test', recommendation: 'test' });

  assert.equal(Engagement.findById(eid).id, eid);
  for (const row of [Target.findByIdForEngagement(tid,eid), SessionStore.findByIdForEngagement(sid,eid), Evidence.findByIdForEngagement(evidenceId,eid), Finding.findByIdForEngagement(findingId,eid)]) assert.equal(row.engagement_id, eid);
  const audit = Database.get().prepare('SELECT action,subject,engagement_id FROM audit_log WHERE engagement_id=? ORDER BY id ASC').all(eid);
  assert.deepEqual(audit.map(x => x.action), ['engagement:created','target:created','session:created','evidence:created','finding:created']);
  assert.ok(audit.every(x => x.engagement_id === eid));
  assert.equal(AuditLog.verify().valid, true);
});

test('Phase 2 lifecycle remains intact after database restart', () => {
  const rows = Database.get().prepare('SELECT id FROM engagements ORDER BY created_at DESC LIMIT 1').all();
  const eid = rows[0].id;
  Database.close();
  Database.init({ path: DB_PATH });
  assert.equal(Engagement.findById(eid).id, eid);
  assert.equal(Target.findByEngagement(eid).length, 1);
  assert.equal(SessionStore.findByEngagement(eid).length, 1);
  assert.equal(Evidence.findByEngagement(eid).length, 1);
  assert.equal(Finding.findByEngagement(eid).length, 1);
  assert.equal(AuditLog.verify().valid, true);
});
