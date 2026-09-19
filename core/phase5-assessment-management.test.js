'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('./db/database');
const Engagement = require('./db/models/engagement');
const Finding = require('./db/models/finding');
const Assessment = require('./assessment/assessment-manager');
const Retest = require('./assessment/retest-store');

let dbPath;
test.beforeEach(() => {
  dbPath = path.join(process.cwd(), `phase5-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  Database.init({ path: dbPath });
});
test.afterEach(() => {
  Database.close();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch {} }
});

test('Phase 5 persists an assessment plan and finding remediation lifecycle', () => {
  const eid = Engagement.create({ name: 'Phase 5', description: 'synthetic', scope: 'localhost' });
  const plan = Assessment.save(eid, { name: 'Controlled Plan', phases: ['discovery', 'validation'], options: { adaptivePacing: false } });
  assert.deepEqual(plan.phases, ['discovery', 'validation']);
  assert.equal(plan.options.adaptivePacing, false);

  const fid = Finding.create({ engagementId: eid, title: 'Synthetic issue', severity: 'high', module: 'webapp', description: 'test' });
  const updated = Finding.updateLifecycle(fid, eid, { status: 'in-progress', remediation_owner: 'operator', remediation_due_at: '2030-01-01T00:00:00Z' });
  assert.equal(updated.status, 'in-progress');
  assert.equal(updated.remediation_owner, 'operator');

  const retest = Retest.create({ engagementId: eid, findingId: fid, notes: 'verify after remediation' });
  assert.equal(retest.status, 'pending');
  const completed = Retest.complete(retest.id, eid, 'passed', 'verified');
  assert.equal(completed.status, 'passed');
  assert.ok(completed.completed_at);
});
