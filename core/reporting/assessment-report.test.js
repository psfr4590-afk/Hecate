'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../db/database');
const Engagement = require('../db/models/engagement');
const Evidence = require('../db/models/evidence');
const Finding = require('../db/models/finding');
const { buildAssessmentReport, toMarkdown } = require('./assessment-report');

test('assessment report is engagement-scoped and excludes raw evidence payloads', () => {
  Database.init({ path: ':memory:' });
  try {
    const eid = Engagement.create({ name: 'Phase 4 synthetic assessment', description: 'Synthetic fixture only', scope: 'example.test' });
    Evidence.create({
      engagementId: eid,
      type: 'http',
      module: 'recon',
      targetId: null,
      label: 'Synthetic response',
      data: 'SECRET_PAYLOAD_MUST_NOT_APPEAR',
      path: 'evidence/example.txt',
    });
    Finding.create({
      engagementId: eid,
      title: 'Missing security header',
      severity: 'medium',
      module: 'webapp',
      targetId: null,
      description: 'Synthetic finding',
      recommendation: 'Add the required security header',
    });

    const report = buildAssessmentReport(eid);
    assert.equal(report.engagement.id, eid);
    assert.equal(report.executiveSummary.findingCount, 1);
    assert.equal(report.executiveSummary.evidenceCount, 1);
    assert.equal(report.findings[0].title, 'Missing security header');
    assert.equal(report.evidence[0].hasStoredPayload, true);
    assert.equal(JSON.stringify(report).includes('SECRET_PAYLOAD_MUST_NOT_APPEAR'), false);

    const markdown = toMarkdown(report);
    assert.match(markdown, /Missing security header/);
    assert.doesNotMatch(markdown, /SECRET_PAYLOAD_MUST_NOT_APPEAR/);
  } finally {
    Database.close();
  }
});
