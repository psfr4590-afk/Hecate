'use strict';

const { randomUUID } = require('crypto');
const engagementIntegrity = require('../../../core/db/engagement-integrity');
let db = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS webapp_scans (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    target_id     TEXT,
    target_url    TEXT NOT NULL,
    config_json   TEXT NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'pending',
    started_at    TEXT,
    finished_at   TEXT,
    error         TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS webapp_requests (
    id           TEXT PRIMARY KEY,
    scan_id      TEXT NOT NULL,
    url          TEXT NOT NULL,
    method       TEXT DEFAULT 'GET',
    fuzz_target  TEXT,
    payload      TEXT,
    status_code  INTEGER,
    bytes        INTEGER,
    is_fuzz_hit  INTEGER DEFAULT 0,
    has_findings INTEGER DEFAULT 0,
    logged_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    error        TEXT,
    FOREIGN KEY (scan_id) REFERENCES webapp_scans(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS webapp_findings (
    id           TEXT PRIMARY KEY,
    scan_id      TEXT NOT NULL,
    engagement_id TEXT,
    url          TEXT NOT NULL,
    check_id     TEXT NOT NULL,
    check_name   TEXT,
    severity     TEXT NOT NULL,
    confidence   TEXT,
    detail       TEXT,
    evidence     TEXT,
    found_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (scan_id) REFERENCES webapp_scans(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_wa_req_scan ON webapp_requests(scan_id);
  CREATE INDEX IF NOT EXISTS idx_wa_find_scan ON webapp_findings(scan_id);
  CREATE INDEX IF NOT EXISTS idx_wa_find_sev  ON webapp_findings(severity);
`;

function init(database) { db = database; db.exec(SCHEMA); engagementIntegrity.install(db, ['webapp_scans']); db.prepare(`UPDATE webapp_scans SET status='interrupted', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), error='Process restarted before scan completion' WHERE status='running'`).run(); }

function createScan({ id, engagementId, targetId, targetUrl, config }) {
  db.prepare(`INSERT OR IGNORE INTO webapp_scans (id, engagement_id, target_id, target_url, config_json)
    VALUES (?,?,?,?,?)`).run(id, engagementId, targetId ?? null, targetUrl, JSON.stringify(config));
}
function startScan(id) {
  db.prepare(`UPDATE webapp_scans SET status='running', started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id);
}
function finishScan(id) {
  db.prepare(`UPDATE webapp_scans SET status='complete', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id);
}
function failScan(id, error) {
  db.prepare(`UPDATE webapp_scans SET status='failed', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), error=? WHERE id=?`).run(String(error), id);
}
function cancelScan(id) {
  db.prepare(`UPDATE webapp_scans SET status='cancelled', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id);
}
function getScan(id) {
  const r = db.prepare(`SELECT * FROM webapp_scans WHERE id=?`).get(id);
  return r ? { ...r, config: JSON.parse(r.config_json) } : null;
}
function listScans(engagementId) {
  return (engagementId
    ? db.prepare(`SELECT * FROM webapp_scans WHERE engagement_id=? ORDER BY created_at DESC`).all(engagementId)
    : db.prepare(`SELECT * FROM webapp_scans ORDER BY created_at DESC`).all()
  ).map(r => ({ ...r, config: JSON.parse(r.config_json) }));
}

function saveRequest({ scanId, req, status, bytes, isFuzzHit, findings, error }) {
  db.prepare(`INSERT OR IGNORE INTO webapp_requests
    (id, scan_id, url, method, fuzz_target, payload, status_code, bytes, is_fuzz_hit, has_findings, error)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(), scanId,
    req.url, req.method ?? 'GET',
    req.fuzzTarget ?? null, req.payload ?? null,
    status ?? null, bytes ?? null,
    isFuzzHit ? 1 : 0, (findings?.length ?? 0) > 0 ? 1 : 0,
    error ?? null
  );
}

function saveFinding({ scanId, engagementId, url, checkId, checkName, severity, confidence, detail, evidence }) {
  db.prepare(`INSERT OR IGNORE INTO webapp_findings
    (id, scan_id, engagement_id, url, check_id, check_name, severity, confidence, detail, evidence)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(), scanId, engagementId ?? null, url,
    checkId, checkName ?? null, severity, confidence ?? null,
    detail ?? null, evidence ?? null
  );
}

function getFindings(scanId, severity) {
  let sql = `SELECT * FROM webapp_findings WHERE scan_id=?`;
  const args = [scanId];
  if (severity) { sql += ` AND severity=?`; args.push(severity); }
  sql += ` ORDER BY found_at ASC`;
  return db.prepare(sql).all(...args);
}

function stats(scanId) {
  const requests  = db.prepare(`SELECT COUNT(*) as n FROM webapp_requests WHERE scan_id=?`).get(scanId)?.n ?? 0;
  const hits      = db.prepare(`SELECT COUNT(*) as n FROM webapp_requests WHERE scan_id=? AND is_fuzz_hit=1`).get(scanId)?.n ?? 0;
  const findings  = db.prepare(`SELECT severity, COUNT(*) as n FROM webapp_findings WHERE scan_id=? GROUP BY severity`).all(scanId);
  return { requests, hits, findings };
}

module.exports = {
  init, createScan, startScan, finishScan, failScan, cancelScan,
  getScan, listScans, saveRequest, saveFinding, getFindings, stats,
};
