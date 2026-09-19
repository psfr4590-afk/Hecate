'use strict';

/**
 * HECATE Phase 3 — module lifecycle projector.
 *
 * Converts module execution events into durable core Sessions. This keeps
 * module-specific stores authoritative for detailed state while the core
 * lifecycle remains the common operator-facing spine:
 *
 *   Engagement -> Target -> Session/Run -> Evidence/Finding -> Audit
 *
 * The projector is deliberately conservative. It never copies sensitive
 * payloads into core session metadata and never creates credentials.
 */

const SessionStore = require('../store/session-store');
const Finding = require('../db/models/finding');

const MODULES = new Set([
  'recon', 'evil-proxy', 'c2', 'delivery', 'mitm', 'webapp', 'post-exploit',
]);

const TERMINAL = /:(complete|completed|finish|finished|failed|error|cancelled|canceled|stopped|killed|dead)$/i;

const RUN_KEYS = [
  'jobId', 'scanId', 'campaignId', 'sessionId', 'victimSid', 'implantId',
  'taskId', 'listenerId', 'lureId', 'ruleId', 'exchangeId',
];

const active = new Map();
const projectedFindings = new Set();

function project(event, data) {
  const module = typeof event === 'string' ? event.split(':')[0] : '';
  if (!MODULES.has(module) || !data || typeof data !== 'object') return;

  const engagementId = data.engagementId ?? data.engagement_id ?? data.eid ?? null;
  if (!engagementId) return;

  const runKey = _runKey(module, data);
  if (!runKey) return;

  const sessionId = _ensureSession(module, engagementId, runKey, data);
  if (!sessionId) return;

  try {
    SessionStore.heartbeatForEngagement(sessionId, engagementId);
  } catch {}

  if (event === 'webapp:finding') _projectWebappFinding(engagementId, data);

  if (TERMINAL.test(event)) {
    try { SessionStore.setInactiveForEngagement(sessionId, engagementId); } catch {}
    active.delete(_mapKey(module, engagementId, runKey));
  }
}

function _ensureSession(module, engagementId, runKey, data) {
  const key = _mapKey(module, engagementId, runKey);
  const cached = active.get(key);
  if (cached) return cached;

  try {
    const existing = SessionStore.findByEngagement(engagementId).find(row => {
      if (row.module !== module || row.status !== 'active') return false;
      try {
        const meta = row.metadata ? JSON.parse(row.metadata) : {};
        return meta.phase3RunKey === runKey;
      } catch {
        return false;
      }
    });
    if (existing) {
      active.set(key, existing.id);
      return existing.id;
    }

    const targetId = data.targetId ?? null;
    const transport = data.transport ?? module;
    const id = SessionStore.create({
      engagementId,
      module,
      targetId,
      transport,
      metadata: {
        phase3RunKey: runKey,
        sourceEvent: String(data.event ?? ''),
      },
    });
    active.set(key, id);
    return id;
  } catch {
    return null;
  }
}

function _projectWebappFinding(engagementId, data) {
  const finding = data.finding ?? data;
  const title = finding.title ?? finding.checkName ?? finding.checkId;
  if (!title) return;

  const targetId = data.targetId ?? finding.targetId ?? null;
  const dedupe = [engagementId, targetId ?? '', title, finding.url ?? ''].join('|');
  if (projectedFindings.has(dedupe)) return;

  try {
    const existing = Finding.findByEngagement(engagementId).find(row =>
      row.module === 'webapp' &&
      row.title === title &&
      (row.target_id ?? null) === targetId &&
      (!finding.url || String(row.description ?? '').includes(String(finding.url)))
    );
    if (existing) {
      projectedFindings.add(dedupe);
      return;
    }

    Finding.create({
      engagementId,
      title: String(title),
      severity: finding.severity ?? 'info',
      module: 'webapp',
      targetId,
      description: [finding.detail, finding.url].filter(Boolean).join(' | ') || null,
      recommendation: finding.recommendation ?? null,
      cvss: finding.cvss ?? null,
    });
    projectedFindings.add(dedupe);
  } catch {}
}

function _runKey(module, data) {
  for (const key of RUN_KEYS) {
    if (data[key] != null && String(data[key]).length) return `${key}:${String(data[key])}`;
  }
  return `module:${module}`;
}

function _mapKey(module, engagementId, runKey) {
  return `${module}|${engagementId}|${runKey}`;
}

function reset() {
  active.clear();
  projectedFindings.clear();
}

module.exports = { project, reset };
