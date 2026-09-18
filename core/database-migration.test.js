'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const Database = require('./db/database');

const DB_PATH = path.join(os.tmpdir(), `hecate-migration-test-${Date.now()}.db`);

after(() => {
  try { Database.close(); } catch {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
});

test('legacy audit_log migration adds engagement_id and preserves existing rows', () => {
  const { DatabaseSync } = require('node:sqlite');
  const legacy = new DatabaseSync(DB_PATH);
  legacy.exec(`
    CREATE TABLE engagements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      scope TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE engagement_operators (
      engagement_id TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      created_at TEXT NOT NULL,
      PRIMARY KEY (engagement_id, operator_id)
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT,
      detail TEXT,
      prev_hash TEXT,
      hash TEXT NOT NULL
    );
  `);
  legacy.prepare(`INSERT INTO engagements(id,name,created_at,updated_at) VALUES(?,?,?,?)`)
    .run('legacy-eng', 'Legacy', new Date().toISOString(), new Date().toISOString());
  const ts = new Date().toISOString();
  const legacyHash = crypto.createHash('sha256').update(`0|${ts}|legacy:test|detail`).digest('hex');
  legacy.prepare(`INSERT INTO audit_log(ts,action,subject,detail,prev_hash,hash) VALUES(?,?,?,?,?,?)`)
    .run(ts, 'legacy:test', 'subject', 'detail', '0', legacyHash);
  legacy.close();

  const db = Database.init({ path: DB_PATH });
  const columns = db.prepare('PRAGMA table_info(audit_log)').all().map(r => r.name);
  assert.ok(columns.includes('engagement_id'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM engagement_operators WHERE engagement_id=?').get('legacy-eng').n, 1);
  assert.equal(require('./audit/audit-log').verify().valid, true);
});
