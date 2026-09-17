'use strict';

const { randomUUID } = require('crypto');
const engagementIntegrity = require('../../../core/db/engagement-integrity');

let db = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS mitm_sessions (
    id            TEXT PRIMARY KEY,
    engagement_id TEXT NOT NULL,
    type          TEXT NOT NULL DEFAULT 'proxy',
    config_json   TEXT NOT NULL DEFAULT '{}',
    active        INTEGER DEFAULT 1,
    started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    stopped_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS mitm_exchanges (
    id          TEXT PRIMARY KEY,
    session_id  TEXT,
    host        TEXT,
    method      TEXT,
    url         TEXT,
    status      INTEGER,
    req_headers TEXT,
    req_body    TEXT,
    res_headers TEXT,
    res_body    TEXT,
    has_creds   INTEGER DEFAULT 0,
    logged_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (session_id) REFERENCES mitm_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mitm_credentials (
    id          TEXT PRIMARY KEY,
    session_id  TEXT,
    exchange_id TEXT,
    host        TEXT,
    url         TEXT,
    field       TEXT,
    type        TEXT,
    redacted    TEXT,
    found_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (session_id) REFERENCES mitm_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mitm_dns_rules (
    id            TEXT PRIMARY KEY,
    session_id    TEXT,
    hostname      TEXT NOT NULL UNIQUE,
    spoof_ip      TEXT NOT NULL,
    hit_count     INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_mitm_ex_session ON mitm_exchanges(session_id);
  CREATE INDEX IF NOT EXISTS idx_mitm_ex_host    ON mitm_exchanges(host);
  CREATE INDEX IF NOT EXISTS idx_mitm_cr_session ON mitm_credentials(session_id);
  CREATE INDEX IF NOT EXISTS idx_mitm_dns_host   ON mitm_dns_rules(hostname);
`;

function init(database) {
  db = database;
  db.exec(SCHEMA);
  engagementIntegrity.install(db, ['mitm_sessions']);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function createSession(engagementId, type, config) {
  const id = randomUUID();
  db.prepare(`INSERT INTO mitm_sessions (id, engagement_id, type, config_json) VALUES (?,?,?,?)`)
    .run(id, engagementId, type ?? 'proxy', JSON.stringify(config ?? {}));
  return id;
}

function getSession(id) {
  const row = db.prepare('SELECT * FROM mitm_sessions WHERE id=?').get(id);
  return row ? { ...row, config: JSON.parse(row.config_json), active: !!row.active } : null;
}

function stopSession(id) {
  db.prepare(`UPDATE mitm_sessions SET active=0, stopped_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(id);
}

function listSessions(engagementId) {
  const rows = engagementId
    ? db.prepare(`SELECT * FROM mitm_sessions WHERE engagement_id=? ORDER BY started_at DESC`).all(engagementId)
    : db.prepare(`SELECT * FROM mitm_sessions ORDER BY started_at DESC`).all();
  return rows.map(r => ({ ...r, config: JSON.parse(r.config_json), active: !!r.active }));
}

// ── Traffic log ───────────────────────────────────────────────────────────────

function logExchange({ sessionId, host, method, url, status,
                       reqHeaders, reqBody, resHeaders, resBody, findings }) {
  const id      = randomUUID();
  const hasCred = findings?.findings?.length > 0 ? 1 : 0;

  db.prepare(`
    INSERT INTO mitm_exchanges
      (id, session_id, host, method, url, status, req_headers, req_body, res_headers, res_body, has_creds)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, sessionId ?? null, host, method, url, status ?? null,
         JSON.stringify(reqHeaders ?? {}),
         reqBody ?? null,
         JSON.stringify(resHeaders ?? {}),
         resBody ?? null,
         hasCred);

  if (hasCred) {
    _saveFindings(id, sessionId, host, url, findings);
  }

  return id;
}

function _saveFindings(exchangeId, sessionId, host, url, sniffResult) {
  const stmt = db.prepare(`
    INSERT INTO mitm_credentials (id, session_id, exchange_id, host, url, field, type, redacted)
    VALUES (?,?,?,?,?,?,?,?)
  `);
  for (const f of sniffResult.findings) {
    stmt.run(randomUUID(), sessionId, exchangeId, host, url, f.field, f.type, f.redacted);
  }
}

function listExchanges({ sessionId, host, hasCredentials, limit = 100 }) {
  let sql  = `SELECT * FROM mitm_exchanges WHERE 1=1`;
  const args = [];
  if (sessionId)      { sql += ` AND session_id=?`;   args.push(sessionId); }
  if (host)           { sql += ` AND host=?`;          args.push(host); }
  if (hasCredentials) { sql += ` AND has_creds=1`; }
  sql += ` ORDER BY logged_at DESC LIMIT ?`;
  args.push(limit);
  return db.prepare(sql).all(...args).map(r => ({
    ...r,
    req_headers: JSON.parse(r.req_headers ?? '{}'),
    res_headers: JSON.parse(r.res_headers ?? '{}'),
    has_creds: !!r.has_creds,
  }));
}

function listCredentials(sessionId) {
  return sessionId
    ? db.prepare(`SELECT * FROM mitm_credentials WHERE session_id=? ORDER BY found_at DESC`).all(sessionId)
    : db.prepare(`SELECT * FROM mitm_credentials ORDER BY found_at DESC`).all();
}

// ── DNS rules ─────────────────────────────────────────────────────────────────

function saveDnsRule(sessionId, hostname, spoofIp) {
  const id = randomUUID();
  db.prepare(`
    INSERT OR REPLACE INTO mitm_dns_rules (id, session_id, hostname, spoof_ip)
    VALUES (?,?,?,?)
  `).run(id, sessionId ?? null, hostname.toLowerCase(), spoofIp);
}

function incrementDnsHit(hostname) {
  db.prepare(`UPDATE mitm_dns_rules SET hit_count=hit_count+1 WHERE hostname=?`).run(hostname.toLowerCase());
}

function listDnsRules(sessionId) {
  return sessionId
    ? db.prepare(`SELECT * FROM mitm_dns_rules WHERE session_id=? ORDER BY created_at DESC`).all(sessionId)
    : db.prepare(`SELECT * FROM mitm_dns_rules ORDER BY created_at DESC`).all();
}

function removeDnsRule(hostname) {
  db.prepare(`DELETE FROM mitm_dns_rules WHERE hostname=?`).run(hostname.toLowerCase());
}

function stats(sessionId) {
  const exchanges = sessionId
    ? db.prepare('SELECT COUNT(*) as n FROM mitm_exchanges WHERE session_id=?').get(sessionId)?.n ?? 0
    : db.prepare('SELECT COUNT(*) as n FROM mitm_exchanges').get()?.n ?? 0;
  const credentials = sessionId
    ? db.prepare('SELECT COUNT(*) as n FROM mitm_credentials WHERE session_id=?').get(sessionId)?.n ?? 0
    : db.prepare('SELECT COUNT(*) as n FROM mitm_credentials').get()?.n ?? 0;
  const dnsHits = sessionId
    ? db.prepare('SELECT COALESCE(SUM(hit_count),0) as n FROM mitm_dns_rules WHERE session_id=?').get(sessionId)?.n ?? 0
    : db.prepare('SELECT COALESCE(SUM(hit_count),0) as n FROM mitm_dns_rules').get()?.n ?? 0;
  return { exchanges, credentials, dnsHits };
}

module.exports = {
  init,
  createSession, getSession, stopSession, listSessions,
  logExchange, listExchanges, listCredentials,
  saveDnsRule, incrementDnsHit, listDnsRules, removeDnsRule,
  stats,
};
