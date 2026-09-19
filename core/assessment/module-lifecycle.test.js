'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');

const Database = require('../db/database');
const Engagement = require('../db/models/engagement');
const SessionStore = require('../store/session-store');
const Finding = require('../db/models/finding');
const AuditLog = require('../audit/audit-log');
const eventBus = require('../events/event-bus');
const eventBridge = require('../../api/websocket/event-bridge');
const moduleLifecycle = require('./module-lifecycle');

let dbPath;

beforeEach(() => {
  dbPath = path.join(process.cwd(), `phase3-lifecycle-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  Database.init({ path: dbPath });
  moduleLifecycle.reset();
  eventBridge.start();
});

afterEach(() => {
  eventBridge.stop();
  moduleLifecycle.reset();
  Database.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
});

test('module execution events become durable core sessions and audit records', () => {
  const engagementId = Engagement.create({ name: 'Phase 3 lifecycle' });

  eventBus.emit('recon:progress', {
    engagementId,
    jobId: 'job-1',
    targetId: null,
    status: 'running',
  });

  const sessions = SessionStore.findByEngagement(engagementId);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].module, 'recon');
  assert.equal(sessions[0].status, 'active');

  eventBus.emit('recon:complete', { engagementId, jobId: 'job-1' });

  const completed = SessionStore.findByEngagement(engagementId);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, 'inactive');

  const audit = AuditLog.list({ engagementId });
  assert.ok(audit.some(row => row.action === 'recon:progress'));
  assert.ok(audit.some(row => row.action === 'recon:complete'));
  assert.equal(AuditLog.verify().valid, true);
});

test('webapp finding events project into core findings without copying sensitive payloads', () => {
  const engagementId = Engagement.create({ name: 'Phase 3 finding projection' });

  eventBus.emit('webapp:finding', {
    engagementId,
    scanId: 'scan-1',
    finding: {
      checkId: 'header-missing',
      checkName: 'Missing security header',
      title: 'Missing security header',
      severity: 'medium',
      detail: 'X-Test header is missing',
      url: 'https://example.test/',
      evidence: 'SECRET_SHOULD_NOT_BE_COPIED',
    },
  });

  const findings = Finding.findByEngagement(engagementId);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].module, 'webapp');
  assert.equal(findings[0].title, 'Missing security header');
  assert.match(findings[0].description, /example\.test/);
  assert.doesNotMatch(findings[0].description ?? '', /SECRET_SHOULD_NOT_BE_COPIED/);
  assert.equal(AuditLog.verify().valid, true);
});
