'use strict';

/**
 * HECATE Core — Database
 * Initialises the SQLite database and runs the base schema migration.
 * Module-specific tables are created by each module's own init().
 * Uses node:sqlite (Node 22+, --experimental-sqlite flag required).
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');
const { OPERATOR_ID } = require('../auth/principal');

let _db = null;

const BASE_SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous   = FULL;

  CREATE TABLE IF NOT EXISTS engagements (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    scope       TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS engagement_operators (
    engagement_id TEXT NOT NULL,
    operator_id   TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'operator',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (engagement_id, operator_id),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_engagement_operators_operator
    ON engagement_operators(operator_id);

  CREATE TABLE IF NOT EXISTS targets (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    type          TEXT NOT NULL,
    value         TEXT NOT NULL,
    label         TEXT,
    metadata      TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(engagement_id, type, value),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS evidence (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    type          TEXT NOT NULL,
    module        TEXT NOT NULL,
    target_id     TEXT,
    label         TEXT,
    data          TEXT,
    path          TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS findings (
    id             TEXT PRIMARY KEY,
    engagement_id  TEXT NOT NULL,
    title          TEXT NOT NULL,
    severity       TEXT NOT NULL,
    module         TEXT,
    target_id      TEXT,
    description    TEXT,
    recommendation TEXT,
    cvss           REAL,
    status         TEXT NOT NULL DEFAULT 'open',
    remediation_owner TEXT,
    remediation_due_at TEXT,
    resolution     TEXT,
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    module        TEXT NOT NULL,
    target_id     TEXT,
    transport     TEXT,
    metadata      TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen     TEXT,
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS credentials (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    type          TEXT NOT NULL,
    username      TEXT,
    secret_enc    TEXT NOT NULL,
    target_id     TEXT,
    metadata      TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    action    TEXT NOT NULL,
    subject   TEXT,
    engagement_id TEXT,
    detail    TEXT,
    prev_hash TEXT,
    hash      TEXT NOT NULL
  );

  CREATE TRIGGER IF NOT EXISTS audit_log_no_update
  BEFORE UPDATE ON audit_log
  BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
  BEFORE DELETE ON audit_log
  BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
  END;

  CREATE TABLE IF NOT EXISTS target_graph_nodes (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    type          TEXT NOT NULL,
    value         TEXT NOT NULL,
    label         TEXT,
    metadata      TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS target_graph_edges (
    id        TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation  TEXT NOT NULL,
    weight    REAL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS ad_graph_nodes (
    id              TEXT PRIMARY KEY,
    engagement_id   TEXT NOT NULL,
    name            TEXT,
    type            TEXT NOT NULL,
    domain          TEXT,
    admin_count     INTEGER DEFAULT 0,
    kerberoastable  INTEGER DEFAULT 0,
    asrep_roastable INTEGER DEFAULT 0,
    spns            TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS ad_graph_edges (
    id         TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    source_id  TEXT NOT NULL,
    target_id  TEXT NOT NULL,
    relation   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS assessment_plans (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL UNIQUE,
    phases        TEXT NOT NULL,
    options       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS finding_retests (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    finding_id    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    notes         TEXT,
    evidence_id   TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    completed_at  TEXT,
    FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
    FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_id) REFERENCES evidence(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_assessment_plans_eid ON assessment_plans(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_finding_retests_eid ON finding_retests(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_finding_retests_finding ON finding_retests(finding_id);

  CREATE INDEX IF NOT EXISTS idx_targets_eid    ON targets(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_evidence_eid   ON evidence(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_findings_eid   ON findings(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_eid   ON sessions(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_creds_eid      ON credentials(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_tgn_eid        ON target_graph_nodes(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_agn_eid        ON ad_graph_nodes(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_age_eid        ON ad_graph_edges(engagement_id);
`;

/**
 * Initialise the database.
 * @param {object} opts
 * @param {string}  opts.path    - path to SQLite file
 * @param {boolean} opts.migrate - run schema migration (default true)
 * @returns {DatabaseSync}
 */
function init(opts = {}) {
  const dbPath = opts.path ?? path.resolve(process.cwd(), 'data', 'hecate.db');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  _db = new DatabaseSync(dbPath);
  _db.exec(BASE_SCHEMA);

  // Existing databases pre-date engagement ownership. Migrate them once to
  // the configured local operator so the new boundary is explicit rather
  // than silently treating legacy rows as globally accessible.
  const defaultOperator = OPERATOR_ID;
  const auditColumns = _db.prepare('PRAGMA table_info(audit_log)').all();
  if (!auditColumns.some(column => column.name === 'engagement_id')) {
    _db.exec('ALTER TABLE audit_log ADD COLUMN engagement_id TEXT');
  }

  const ensureColumn = (table, column, definition) => {
    const columns = _db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(row => row.name === column)) {
      _db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  ensureColumn('findings', 'status', "TEXT NOT NULL DEFAULT 'open'");
  ensureColumn('findings', 'remediation_owner', 'TEXT');
  ensureColumn('findings', 'remediation_due_at', 'TEXT');
  ensureColumn('findings', 'resolution', 'TEXT');
  ensureColumn('findings', 'updated_at', 'TEXT');

  _db.prepare(`
    INSERT OR IGNORE INTO engagement_operators (engagement_id, operator_id, role, created_at)
    SELECT id, ?, 'owner', strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM engagements
  `).run(defaultOperator);

  return _db;
}

function get() {
  if (!_db) throw new Error('Database not initialised — call Database.init() first');
  return _db;
}

function close() {
  if (_db) { _db.close(); _db = null; }
}

module.exports = { init, get, close };
