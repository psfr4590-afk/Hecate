'use strict';
const crypto = require('crypto');
const db     = () => require('../db/database').get();

function _hash(prev, ts, action, detail) {
  return crypto.createHash('sha256').update(`${prev}|${ts}|${action}|${detail}`).digest('hex');
}

function append(action, subject, detail, engagementId = null) {
  const prev = db().prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get()?.hash ?? '0';
  const ts   = new Date().toISOString();
  const hash = _hash(prev, ts, action, String(detail ?? ''));
  db().prepare('INSERT INTO audit_log (ts,action,subject,engagement_id,detail,prev_hash,hash) VALUES (?,?,?,?,?,?,?)')
    .run(ts, action, subject ?? null, engagementId ?? null, detail ?? null, prev, hash);
  return hash;
}

function tail(n = 50, engagementId = null) {
  const lim = Math.min(n, 500);
  if (engagementId) return db().prepare('SELECT * FROM audit_log WHERE engagement_id=? ORDER BY id DESC LIMIT ?').all(engagementId, lim);
  return db().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(lim);
}

function range(from, to, engagementId = null) {
  if (engagementId) return db().prepare('SELECT * FROM audit_log WHERE engagement_id=? AND ts>=? AND ts<=? ORDER BY id ASC').all(engagementId, from, to);
  return db().prepare('SELECT * FROM audit_log WHERE ts>=? AND ts<=? ORDER BY id ASC').all(from, to);
}

function verify() {
  const rows = db().prepare('SELECT * FROM audit_log ORDER BY id ASC').all();
  if (!rows.length) return { valid: true, checked: 0 };

  for (let i = 0; i < rows.length; i++) {
    const r    = rows[i];
    const prev = i === 0 ? '0' : rows[i - 1].hash;
    const expected = _hash(prev, r.ts, r.action, String(r.detail ?? ''));
    if (expected !== r.hash) {
      return { valid: false, checked: i + 1, failedAt: r.id, message: `Hash mismatch at row ${r.id}` };
    }
  }
  return { valid: true, checked: rows.length };
}

module.exports = { append, tail, range, verify };
