'use strict';

/**
 * HECATE C2 — SQLite Storage
 * Persists implant registrations, tasks, results, and listener configs.
 * Implant keys stored encrypted via core KeyManager (never plaintext at rest).
 */

const { randomUUID } = require('crypto');
const engagementIntegrity = require('../../../core/db/engagement-integrity');

let db         = null;
let KeyManager = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS c2_listeners (
    id           TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    host         TEXT NOT NULL DEFAULT '0.0.0.0',
    port         INTEGER NOT NULL,
    transport    TEXT NOT NULL DEFAULT 'https',
    active       INTEGER DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS c2_implants (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    profile_id    TEXT,
    key_enc       TEXT NOT NULL,
    os            TEXT,
    arch          TEXT,
    hostname      TEXT,
    user_name     TEXT,
    integrity     TEXT DEFAULT 'medium',
    ip            TEXT,
    sleep_sec     INTEGER DEFAULT 30,
    jitter_pct    INTEGER DEFAULT 20,
    state         TEXT DEFAULT 'pending',
    first_seen    TEXT,
    last_seen     TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS c2_tasks (
    id           TEXT PRIMARY KEY,
    implant_id   TEXT NOT NULL,
    type         TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'queued',
    priority     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    claimed_at   TEXT,
    completed_at TEXT,
    FOREIGN KEY (implant_id) REFERENCES c2_implants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS c2_results (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL,
    implant_id   TEXT NOT NULL,
    output_enc   TEXT NOT NULL,
    exit_code    INTEGER DEFAULT 0,
    error        TEXT,
    received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (task_id)    REFERENCES c2_tasks(id)    ON DELETE CASCADE,
    FOREIGN KEY (implant_id) REFERENCES c2_implants(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_c2_implants_eid  ON c2_implants(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_c2_tasks_implant ON c2_tasks(implant_id);
  CREATE INDEX IF NOT EXISTS idx_c2_tasks_status  ON c2_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_c2_results_task  ON c2_results(task_id);
`;

function init(database, keyManager) {
  db         = database;
  KeyManager = keyManager;
  db.exec(SCHEMA);
  try { db.exec("ALTER TABLE c2_tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0"); } catch {}
  engagementIntegrity.install(db, ['c2_listeners','c2_implants']);
  engagementIntegrity.install(db, ['c2_listeners','c2_implants']);
}

// ── Implants ──────────────────────────────────────────────────────────────────

/**
 * Register a new implant. Key is a raw 32-byte Buffer.
 */
async function registerImplant({ id, engagementId, profileId, key, sleepSec, jitterPct }) {
  const keyEnc = await KeyManager.encrypt(key.toString('base64'));
  db.prepare(`
    INSERT OR IGNORE INTO c2_implants
      (id, engagement_id, profile_id, key_enc, sleep_sec, jitter_pct, state)
    VALUES (?,?,?,?,?,?,'pending')
  `).run(id ?? randomUUID(), engagementId, profileId ?? null,
         keyEnc, sleepSec ?? 30, jitterPct ?? 20);
  return id;
}

async function getImplant(id) {
  return db.prepare(`SELECT * FROM c2_implants WHERE id=?`).get(id) ?? null;
}

async function decryptImplantKey(keyEnc) {
  const b64 = await KeyManager.decrypt(keyEnc);
  return Buffer.from(b64, 'base64');
}

async function updateLastSeen(implantId) {
  db.prepare(`
    UPDATE c2_implants
    SET last_seen=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        first_seen=COALESCE(first_seen, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        state='active'
    WHERE id=? AND state != 'killed'
  `).run(implantId);
}

async function updateImplantInfo(implantId, info) {
  db.prepare(`
    UPDATE c2_implants
    SET os=?, arch=?, hostname=?, user_name=?, integrity=?, ip=?
    WHERE id=?
  `).run(info.os ?? null, info.arch ?? null, info.hostname ?? null,
         info.user ?? null, info.integrity ?? null, info.ip ?? null,
         implantId);
}

function listImplants(engagementId) {
  return engagementId
    ? db.prepare(`SELECT * FROM c2_implants WHERE engagement_id=? ORDER BY created_at DESC`).all(engagementId)
    : db.prepare(`SELECT * FROM c2_implants ORDER BY created_at DESC`).all();
}

function listImplantsForOperator(operatorId) {
  return db.prepare(`
    SELECT i.*
    FROM c2_implants i
    JOIN engagement_operators eo ON eo.engagement_id=i.engagement_id
    WHERE eo.operator_id=?
    ORDER BY i.created_at DESC
  `).all(operatorId);
}

function killImplant(id) {
  db.prepare(`UPDATE c2_implants SET state='killed' WHERE id=?`).run(id);
}

function isKilled(id) {
  return db.prepare(`SELECT state FROM c2_implants WHERE id=?`).get(id)?.state === 'killed';
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

async function saveTasks(tasks) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO c2_tasks (id, implant_id, type, payload_json, status, claimed_at)
    VALUES (?,?,?,?,?,?)
  `);
  for (const t of tasks) {
    stmt.run(t.id, t.implantId, t.type,
             JSON.stringify(t.payload ?? {}),
             t.status ?? 'claimed',
             t.claimedAt ?? null);
  }
}

function getTask(id) {
  const row = db.prepare(`SELECT * FROM c2_tasks WHERE id=?`).get(id);
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload_json) };
}

function listTasks(implantId, status) {
  let sql  = `SELECT * FROM c2_tasks WHERE implant_id=?`;
  const args = [implantId];
  if (status) { sql += ` AND status=?`; args.push(status); }
  sql += ` ORDER BY priority DESC, created_at ASC`;
  return db.prepare(sql).all(...args).map(r => ({ ...r, payload: JSON.parse(r.payload_json) }));
}

function enqueueTask(task) {
  db.prepare(`INSERT OR IGNORE INTO c2_tasks (id, implant_id, type, payload_json, status, priority) VALUES (?,?,?,?,?,?)`)
    .run(task.id, task.implantId, task.type, JSON.stringify(task.payload ?? {}), 'queued', task.priority ?? 0);
  return getTask(task.id);
}

function claimTasks(implantId, max = 10) {
  const rows = db.prepare(`SELECT * FROM c2_tasks WHERE implant_id=? AND status='queued' ORDER BY priority DESC, created_at ASC LIMIT ?`).all(implantId, Math.max(1, Math.min(100, max)));
  if (!rows.length) return [];
  const now = new Date().toISOString();
  const update = db.prepare(`UPDATE c2_tasks SET status='claimed', claimed_at=? WHERE id=? AND status='queued'`);
  const out = [];
  for (const row of rows) {
    const r = update.run(now, row.id);
    if (r.changes) out.push({ ...row, status:'claimed', claimed_at:now, claimedAt:now, implantId:row.implant_id, createdAt:row.created_at, payload: JSON.parse(row.payload_json) });
  }
  return out;
}

function cancelQueuedTask(implantId, taskId) {
  return db.prepare(`DELETE FROM c2_tasks WHERE id=? AND implant_id=? AND status='queued'`).run(taskId, implantId).changes > 0;
}
function cancelQueuedTasks(implantId) {
  return db.prepare(`DELETE FROM c2_tasks WHERE implant_id=? AND status='queued'`).run(implantId).changes;
}
function cancelAllQueuedTasks() {
  return db.prepare(`DELETE FROM c2_tasks WHERE status='queued'`).run().changes;
}

function markTaskComplete(taskId) {
  db.prepare(`
    UPDATE c2_tasks
    SET status='complete', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=?
  `).run(taskId);
}

// ── Results ───────────────────────────────────────────────────────────────────

async function saveResult(taskId, implantId, result) {
  const outputEnc = await KeyManager.encrypt(result.output ?? '');
  db.prepare(`
    INSERT OR IGNORE INTO c2_results (id, task_id, implant_id, output_enc, exit_code, error)
    VALUES (?,?,?,?,?,?)
  `).run(randomUUID(), taskId, implantId, outputEnc,
         result.exitCode ?? 0, result.error ?? null);
  markTaskComplete(taskId);
}

async function getResult(taskId) {
  const row = db.prepare(`SELECT * FROM c2_results WHERE task_id=?`).get(taskId);
  if (!row) return null;
  const output = await KeyManager.decrypt(row.output_enc);
  return { ...row, output };
}

async function listResults(implantId, limit = 50) {
  const rows = db.prepare(`
    SELECT r.*, t.type as task_type
    FROM c2_results r
    JOIN c2_tasks t ON r.task_id = t.id
    WHERE r.implant_id=?
    ORDER BY r.received_at DESC
    LIMIT ?
  `).all(implantId, limit);

  const out = [];
  for (const r of rows) {
    const output = await KeyManager.decrypt(r.output_enc);
    out.push({ ...r, output });
  }
  return out;
}

// ── Listeners ─────────────────────────────────────────────────────────────────

function saveListener({ id, engagementId, host, port, transport }) {
  db.prepare(`
    INSERT OR REPLACE INTO c2_listeners (id, engagement_id, host, port, transport)
    VALUES (?,?,?,?,?)
  `).run(id ?? randomUUID(), engagementId, host, port, transport ?? 'https');
}

function listListeners(engagementId) {
  return engagementId
    ? db.prepare(`SELECT * FROM c2_listeners WHERE engagement_id=? ORDER BY created_at DESC`).all(engagementId)
    : db.prepare(`SELECT * FROM c2_listeners ORDER BY created_at DESC`).all();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function stats(engagementId) {
  const implants = engagementId
    ? db.prepare('SELECT state, COUNT(*) as n FROM c2_implants WHERE engagement_id=? GROUP BY state').all(engagementId)
    : db.prepare('SELECT state, COUNT(*) as n FROM c2_implants GROUP BY state').all();
  const tasks = engagementId
    ? db.prepare('SELECT t.status, COUNT(*) as n FROM c2_tasks t JOIN c2_implants i ON i.id=t.implant_id WHERE i.engagement_id=? GROUP BY t.status').all(engagementId)
    : db.prepare('SELECT status, COUNT(*) as n FROM c2_tasks GROUP BY status').all();
  return { implants, tasks };
}


function statsForOperator(operatorId) {
  const implants = db.prepare(`
    SELECT i.state, COUNT(*) as n
    FROM c2_implants i
    JOIN engagement_operators eo ON eo.engagement_id=i.engagement_id
    WHERE eo.operator_id=?
    GROUP BY i.state
  `).all(operatorId);
  const tasks = db.prepare(`
    SELECT t.status, COUNT(*) as n
    FROM c2_tasks t
    JOIN c2_implants i ON i.id=t.implant_id
    JOIN engagement_operators eo ON eo.engagement_id=i.engagement_id
    WHERE eo.operator_id=?
    GROUP BY t.status
  `).all(operatorId);
  return { implants, tasks };
}

module.exports = {
  init,
  registerImplant, getImplant, decryptImplantKey, updateLastSeen,
  updateImplantInfo, listImplants, listImplantsForOperator, killImplant, isKilled,
  saveTasks, enqueueTask, claimTasks, cancelQueuedTask, cancelQueuedTasks, cancelAllQueuedTasks, getTask, listTasks, markTaskComplete,
  saveResult, getResult, listResults,
  saveListener, listListeners,
  stats, statsForOperator,
};
