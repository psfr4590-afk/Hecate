'use strict';

/** HECATE Phase 4: deterministic engagement-scoped assessment report. */
const Engagement = require('../db/models/engagement');
const Target = require('../db/models/target');
const SessionStore = require('../store/session-store');
const Evidence = require('../db/models/evidence');
const Finding = require('../db/models/finding');
const AuditLog = require('../audit/audit-log');
const Retest = require('../assessment/retest-store');
const Assessment = require('../assessment/assessment-manager');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

function buildAssessmentReport(engagementId) {
  const engagement = Engagement.findById(engagementId);
  if (!engagement) return null;
  const targets = Target.findByEngagement(engagementId);
  const sessions = SessionStore.findByEngagement(engagementId);
  const evidence = Evidence.findByEngagement(engagementId);
  const findings = Finding.findByEngagement(engagementId);
  const audit = AuditLog.tail(500, engagementId);
  const plan = Assessment.get(engagementId);
  const retests = findings.flatMap(f => Retest.listForFinding(f.id, engagementId));
  const severityCounts = Object.fromEntries(SEVERITIES.map(level => [level, findings.filter(row => row.severity === level).length]));
  const moduleCounts = {};
  for (const row of findings) { const key = row.module || 'unclassified'; moduleCounts[key] = (moduleCounts[key] || 0) + 1; }
  const sessionStatus = {};
  for (const row of sessions) { const key = row.status || 'unknown'; sessionStatus[key] = (sessionStatus[key] || 0) + 1; }
  const targetTypes = {};
  for (const row of targets) { const key = row.type || 'unknown'; targetTypes[key] = (targetTypes[key] || 0) + 1; }
  return {
    generatedAt: new Date().toISOString(),
    engagement: { id: engagement.id, name: engagement.name, description: engagement.description, scope: engagement.scope, status: engagement.status, createdAt: engagement.created_at, updatedAt: engagement.updated_at },
    executiveSummary: { targetCount: targets.length, sessionCount: sessions.length, evidenceCount: evidence.length, findingCount: findings.length, severityCounts, auditEntries: audit.length, auditChainValid: AuditLog.verify().valid },
    inventory: { targetTypes, sessionStatus, findingsByModule: moduleCounts, findingStatuses: findings.reduce((a,r) => { const k=r.status||'open'; a[k]=(a[k]||0)+1; return a; }, {}) },
    targets: targets.map(row => ({ id: row.id, type: row.type, value: row.value, label: row.label, status: row.status })),
    findings: findings.map(row => ({ id: row.id, title: row.title, severity: row.severity, status: row.status || 'open', module: row.module, targetId: row.target_id, description: row.description, recommendation: row.recommendation, cvss: row.cvss, remediationOwner: row.remediation_owner, remediationDueAt: row.remediation_due_at, resolution: row.resolution, createdAt: row.created_at, updatedAt: row.updated_at })),
    evidence: evidence.map(row => ({ id: row.id, type: row.type, module: row.module, targetId: row.target_id, label: row.label, path: row.path, createdAt: row.created_at, hasStoredPayload: row.data != null })),
    sessions: sessions.map(row => ({ id: row.id, module: row.module, targetId: row.target_id, transport: row.transport, status: row.status, createdAt: row.created_at, lastSeen: row.last_seen })),
    audit: audit.map(row => ({ id: row.id, ts: row.ts, action: row.action, subject: row.subject, engagementId: row.engagement_id })),
    plan,
    retests,
  };
}

function toMarkdown(report) {
  const s = report.executiveSummary, e = report.engagement;
  const lines = ['# HECATE Assessment Report', '', '## Engagement', '**' + _safe(e.name) + '**', '', e.description ? _safe(e.description) : 'No engagement description recorded.', '',
    '- Status: ' + _safe(e.status || 'unknown'), '- Scope: ' + _safe(e.scope || 'not recorded'), '- Targets: ' + s.targetCount, '- Sessions: ' + s.sessionCount, '- Evidence records: ' + s.evidenceCount, '- Findings: ' + s.findingCount, '- Audit entries: ' + s.auditEntries, '- Audit chain: ' + (s.auditChainValid ? 'valid' : 'INVALID'), '', '## Findings', ''];
  for (const f of report.findings) lines.push('### ' + _safe(f.title), '', '- Severity: ' + _safe(f.severity), '- Module: ' + _safe(f.module || 'unclassified'), '- Target: ' + _safe(f.targetId || 'not linked'), '- CVSS: ' + (f.cvss ?? 'not recorded'), '- Description: ' + _safe(f.description || 'No description recorded.'), '- Recommendation: ' + _safe(f.recommendation || 'No recommendation recorded.'), '');
  if (!report.findings.length) lines.push('No findings recorded.', '');
  lines.push('## Assessment Inventory', '', 'Targets: ' + s.targetCount, '');
  for (const [k,v] of Object.entries(report.inventory.targetTypes)) lines.push('- ' + _safe(k) + ': ' + v);
  lines.push('', '## Evidence Index', '');
  for (const x of report.evidence) lines.push('- ' + _safe(x.label || x.type) + ' — ' + _safe(x.module || 'unclassified') + ' — ' + _safe(x.path || 'stored record'));
  if (!report.evidence.length) lines.push('No evidence records recorded.');
  lines.push('', 'Retests: ' + report.executiveSummary.retestCount, '', 'Report generated by HECATE at ' + _safe(report.generatedAt) + '.');
  return lines.join('\n');
}

function _safe(value) { return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/[<>]/g, ''); }
module.exports = { buildAssessmentReport, toMarkdown };