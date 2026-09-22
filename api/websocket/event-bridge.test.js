'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(os.tmpdir(), `hecate-event-bridge-${process.pid}-${Date.now()}.db`);
const Database = require('../../core/db/database');
const eventBus = require('../../core/events/event-bus');
const bridge = require('./event-bridge');

before(() => {
  fs.writeFileSync(DB_PATH + '.seed', crypto.randomBytes(1));
  Database.init({ path: DB_PATH });
  bridge.start();
});

after(() => {
  bridge.stop();
  try { Database.close(); } catch {}
  for (const suffix of ['', '-wal', '-shm', '.seed']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
});

test('security event is projected into the audit chain without sensitive payload fields', () => {
  eventBus.emit('delivery:unit_test', {
    engagementId: 'eng-audit',
    targetId: 'target-1',
    state: 'completed',
    token: 'DO-NOT-PERSIST',
    password: 'DO-NOT-PERSIST',
    nested: { secret: 'DO-NOT-PERSIST', value: 'safe' },
  });

  const row = Database.get().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.action, 'delivery:unit_test');
  assert.equal(row.engagement_id, 'eng-audit');
  assert.equal(row.subject, 'target-1');
  assert.ok(!row.detail.includes('DO-NOT-PERSIST'));
  assert.ok(row.detail.includes('completed'));
  assert.equal(require('../../core/audit/audit-log').verify().valid, true);
});


test('audit append failure is fail-closed and does not broadcast or project the event', () => {
  const AuditLog = require('../../core/audit/audit-log');
  const wsServer = require('./ws-server');
  const lifecycle = require('../../core/assessment/module-lifecycle');
  const originalAppend = AuditLog.append;
  const originalBroadcast = wsServer.broadcast;
  const originalProject = lifecycle.project;
  let broadcasts = 0;
  let projections = 0;

  AuditLog.append = () => { throw new Error('synthetic audit failure'); };
  wsServer.broadcast = () => { broadcasts += 1; };
  lifecycle.project = () => { projections += 1; };

  try {
    assert.throws(
      () => eventBus.emit('delivery:audit_required_test', { engagementId: 'eng-audit', id: 'target-2' }),
      /Mandatory audit append failed/
    );
    assert.equal(broadcasts, 0);
    assert.equal(projections, 0);
  } finally {
    AuditLog.append = originalAppend;
    wsServer.broadcast = originalBroadcast;
    lifecycle.project = originalProject;
  }
});
