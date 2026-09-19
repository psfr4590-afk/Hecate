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
