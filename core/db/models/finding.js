'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../database').get();

function findById(id) { return db().prepare('SELECT * FROM findings WHERE id=?').get(id) ?? null; }
function findByIdForEngagement(id, engagementId) { return db().prepare('SELECT * FROM findings WHERE id=? AND engagement_id=?').get(id, engagementId) ?? null; }
function findByEngagement(eid) { return db().prepare('SELECT * FROM findings WHERE engagement_id=? ORDER BY created_at DESC').all(eid); }
function create({ engagementId, title, severity, module: mod, targetId, description, recommendation, cvss }) {
  const id = randomUUID();
  db().prepare('INSERT INTO findings (id,engagement_id,title,severity,module,target_id,description,recommendation,cvss) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, engagementId, title, severity, mod ?? null, targetId ?? null, description ?? null, recommendation ?? null, cvss ?? null);
  return id;
}
function removeForEngagement(id, engagementId) { return db().prepare('DELETE FROM findings WHERE id=? AND engagement_id=?').run(id, engagementId); }
function remove(id) { db().prepare('DELETE FROM findings WHERE id=?').run(id); }
module.exports = { findById, findByIdForEngagement, findByEngagement, create, remove, removeForEngagement };
