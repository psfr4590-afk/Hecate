'use strict';

/**
 * HECATE Recon — Recon Store
 * SQLite persistence layer for crawl jobs and their results.
 * Separate from the core DB schema — recon data lives in its own tables
 * and is linked to core by engagementId.
 *
 * Uses node:sqlite (Node 22+).
 * Schema is created on first use — no separate migration step.
 */

let db = null; // will be injected by index.js

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS recon_jobs (
    id           TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    target_id    TEXT,
    seed_urls    TEXT NOT NULL,
    config       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    started_at   TEXT,
    finished_at  TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS recon_pages (
    id           TEXT PRIMARY KEY,
    job_id       TEXT NOT NULL,
    url          TEXT NOT NULL,
    depth        INTEGER NOT NULL DEFAULT 0,
    parent_url   TEXT,
    status_code  INTEGER,
    content_type TEXT,
    title        TEXT,
    page_type    TEXT,
    page_conf    TEXT,
    tech_summary TEXT,
    bytes        INTEGER DEFAULT 0,
    link_count   INTEGER DEFAULT 0,
    form_count   INTEGER DEFAULT 0,
    has_secrets  INTEGER DEFAULT 0,
    crawled_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    error        TEXT,
    FOREIGN KEY (job_id) REFERENCES recon_jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recon_secrets (
    id           TEXT PRIMARY KEY,
    job_id       TEXT NOT NULL,
    page_id      TEXT NOT NULL,
    type         TEXT NOT NULL,
    conf         TEXT NOT NULL,
    redacted     TEXT NOT NULL,
    length       INTEGER,
    entropy      REAL,
    context      TEXT,
    line         INTEGER,
    found_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (job_id) REFERENCES recon_jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recon_forms (
    id           TEXT PRIMARY KEY,
    job_id       TEXT NOT NULL,
    page_id      TEXT NOT NULL,
    action_url   TEXT,
    method       TEXT DEFAULT 'GET',
    fields_json  TEXT,
    found_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (job_id) REFERENCES recon_jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_recon_pages_job   ON recon_pages(job_id);
  CREATE INDEX IF NOT EXISTS idx_recon_pages_type  ON recon_pages(page_type);
  CREATE INDEX IF NOT EXISTS idx_recon_secrets_job ON recon_secrets(job_id);
  CREATE INDEX IF NOT EXISTS idx_recon_forms_job   ON recon_forms(job_id);
`;

function init(database) {
  db = database;
  db.exec(SCHEMA);
  engagementIntegrity.install(db, ['recon_jobs']);
  db.prepare(`UPDATE recon_jobs SET status='interrupted', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), error='Process restarted before job completion' WHERE status='running'`).run();
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

function createJob({ id, engagementId, targetId, seedUrls, config }) {
  db.prepare(`
    INSERT INTO recon_jobs (id, engagement_id, target_id, seed_urls, config, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, engagementId, targetId ?? null, JSON.stringify(seedUrls), JSON.stringify(config));
  return id;
}

function startJob(id) {
  db.prepare(`UPDATE recon_jobs SET status='running', started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id);
}

function finishJob(id) {
  db.prepare(`UPDATE recon_jobs SET status='complete', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id);
}

function failJob(id, error) {
  db.prepare(`UPDATE recon_jobs SET status='failed', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), error=? WHERE id=?`).run(String(error), id);
}

function cancelJob(id) {
  db.prepare(`UPDATE recon_jobs SET status='cancelled', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id);
}

function getJob(id) {
  return db.prepare(`SELECT * FROM recon_jobs WHERE id=?`).get(id);
}

function listJobs(engagementId) {
  const q = engagementId
    ? db.prepare(`SELECT * FROM recon_jobs WHERE engagement_id=? ORDER BY created_at DESC`)
    : db.prepare(`SELECT * FROM recon_jobs ORDER BY created_at DESC`);
  return (engagementId ? q.all(engagementId) : q.all()).map(deserializeJob);
}

function deserializeJob(row) {
  if (!row) return null;
  return { ...row, seed_urls: JSON.parse(row.seed_urls), config: JSON.parse(row.config) };
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function savePage({ id, jobId, url, depth, parentUrl, statusCode, contentType,
                    title, pageType, pageConf, techSummary, bytes, linkCount,
                    formCount, hasSecrets, error }) {
  db.prepare(`
    INSERT OR REPLACE INTO recon_pages
      (id, job_id, url, depth, parent_url, status_code, content_type,
       title, page_type, page_conf, tech_summary, bytes, link_count,
       form_count, has_secrets, error)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, jobId, url, depth, parentUrl ?? null, statusCode ?? null,
         contentType ?? null, title ?? null, pageType ?? null, pageConf ?? null,
         techSummary ? JSON.stringify(techSummary) : null,
         bytes ?? 0, linkCount ?? 0, formCount ?? 0,
         hasSecrets ? 1 : 0, error ?? null);
}

function getPagesByJob(jobId, opts = {}) {
  let sql = `SELECT * FROM recon_pages WHERE job_id=?`;
  const args = [jobId];
  if (opts.type)       { sql += ` AND page_type=?`;   args.push(opts.type); }
  if (opts.hasSecrets) { sql += ` AND has_secrets=1`; }
  sql += ` ORDER BY crawled_at ASC`;
  if (opts.limit) { sql += ` LIMIT ?`; args.push(opts.limit); }
  return db.prepare(sql).all(...args);
}

// ── Secrets ───────────────────────────────────────────────────────────────────

function saveSecrets(jobId, pageId, findings) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO recon_secrets
      (id, job_id, page_id, type, conf, redacted, length, entropy, context, line)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  const { randomUUID } = require('crypto');
const engagementIntegrity = require('../../../core/db/engagement-integrity');
  for (const f of findings) {
    stmt.run(randomUUID(), jobId, pageId,
             f.type, f.conf, f.redacted,
             f.length ?? null, f.entropy ?? null,
             f.context ?? null, f.line ?? null);
  }
}

function getSecretsByJob(jobId) {
  return db.prepare(`SELECT * FROM recon_secrets WHERE job_id=? ORDER BY found_at ASC`).all(jobId);
}

// ── Forms ─────────────────────────────────────────────────────────────────────

function saveForms(jobId, pageId, forms) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO recon_forms (id, job_id, page_id, action_url, method, fields_json)
    VALUES (?,?,?,?,?,?)
  `);
  const { randomUUID } = require('crypto');
const engagementIntegrity = require('../../../core/db/engagement-integrity');
  for (const f of forms) {
    stmt.run(randomUUID(), jobId, pageId,
             f.action ?? null, f.method ?? 'GET',
             JSON.stringify(f.fields ?? []));
  }
}

function getFormsByJob(jobId) {
  return db.prepare(`SELECT * FROM recon_forms WHERE job_id=? ORDER BY found_at ASC`).all(jobId).map(r => ({
    ...r, fields: JSON.parse(r.fields_json ?? '[]')
  }));
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function jobStats(jobId) {
  const pages   = db.prepare(`SELECT COUNT(*) as n FROM recon_pages   WHERE job_id=?`).get(jobId)?.n ?? 0;
  const secrets = db.prepare(`SELECT COUNT(*) as n FROM recon_secrets WHERE job_id=?`).get(jobId)?.n ?? 0;
  const forms   = db.prepare(`SELECT COUNT(*) as n FROM recon_forms   WHERE job_id=?`).get(jobId)?.n ?? 0;
  const byType  = db.prepare(`SELECT page_type, COUNT(*) as n FROM recon_pages WHERE job_id=? GROUP BY page_type`).all(jobId);
  return { pages, secrets, forms, byType };
}

module.exports = {
  init,
  createJob, startJob, finishJob, failJob, cancelJob, getJob, listJobs,
  savePage, getPagesByJob,
  saveSecrets, getSecretsByJob,
  saveForms, getFormsByJob,
  jobStats,
};
