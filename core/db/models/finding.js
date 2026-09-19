'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../database').get();
const eventBus = require('../../events/event-bus');

const STATUSES = new Set(['open', 'in-progress', 'resolved', 'accepted-risk', 'false-positive', 'retest-pending']);

function findById(id) { return db().prepare('SELECT * FROM findings WHERE id=?').get(id) ?? null; }
function findByIdForEngagement(id, eid) { return db().prepare('SELECT * FROM findings WHERE id=? AND engagement_id=?').get(id, eid) ?? null; }
function findByEngagement(eid) { return db().prepare('SELECT * FROM findings WHERE engagement_id=? ORDER BY created_at DESC').all(eid); }

function create({ engagementId, title, severity, module: mod, targetId, description, recommendation, cvss }) {
  const id = randomUUID();
  db().prepare('INSERT INTO findings (id,engagement_id,title,severity,module,target_id,description,recommendation,cvss,status) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, engagementId, title, severity, mod ?? null, targetId ?? null, description ?? null, recommendation ?? null, cvss ?? null, 'open');
  eventBus.emit('finding:created', { engagementId, subject: id, findingId: id, title, severity, module: mod, targetId, cvss });
  return id;
}

function updateLifecycle(id, eid, fields = {}) {
  const row = findByIdForEngagement(id, eid);
  if (!row) return null;
  const allowed = ['status', 'remediation_owner', 'remediation_due_at', 'resolution'];
  const sets = [], values = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      if (key === 'status' && !STATUSES.has(fields[key])) throw new TypeError('Invalid finding status');
      sets.push(`${key}=?`);
      values.push(fields[key] ?? null);
    }
  }
  if (!sets.length) return row;
  sets.push("updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  values.push(id, eid);
  db().prepare(`UPDATE findings SET ${sets.join(',')} WHERE id=? AND engagement_id=?`).run(...values);
  eventBus.emit('finding:updated', { engagementId: eid, subject: id, findingId: id, changes: allowed.filter(k => fields[k] !== undefined) });
  return findByIdForEngagement(id, eid);
}

function removeForEngagement(id, eid) {
  const r = db().prepare('DELETE FROM findings WHERE id=? AND engagement_id=?').run(id, eid);
  if (r.changes) eventBus.emit('finding:deleted', { engagementId: eid, subject: id, findingId: id });
  return r;
}
function remove(id) { const row = findById(id); return removeForEngagement(id, row?.engagement_id); }

module.exports = { STATUSES, findById, findByIdForEngagement, findByEngagement, create, updateLifecycle, remove, removeForEngagement };
