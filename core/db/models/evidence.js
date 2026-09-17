'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../database').get();

function findById(id) { return db().prepare('SELECT * FROM evidence WHERE id=?').get(id) ?? null; }
function findByIdForEngagement(id, engagementId) { return db().prepare('SELECT * FROM evidence WHERE id=? AND engagement_id=?').get(id, engagementId) ?? null; }
function findByEngagement(eid) { return db().prepare('SELECT * FROM evidence WHERE engagement_id=? ORDER BY created_at DESC').all(eid); }
function findByTarget(tid) { return db().prepare('SELECT * FROM evidence WHERE target_id=? ORDER BY created_at DESC').all(tid); }
function findByTargetForEngagement(tid, engagementId) { return db().prepare('SELECT * FROM evidence WHERE target_id=? AND engagement_id=? ORDER BY created_at DESC').all(tid, engagementId); }
function create({ engagementId, type, module: mod, targetId, label, data, path: p }) {
  const id = randomUUID();
  db().prepare('INSERT INTO evidence (id,engagement_id,type,module,target_id,label,data,path) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, engagementId, type, mod, targetId ?? null, label ?? null, data ?? null, p ?? null);
  return id;
}
function removeForEngagement(id, engagementId) { return db().prepare('DELETE FROM evidence WHERE id=? AND engagement_id=?').run(id, engagementId); }
function remove(id) { db().prepare('DELETE FROM evidence WHERE id=?').run(id); }
module.exports = { findById, findByIdForEngagement, findByEngagement, findByTarget, findByTargetForEngagement, create, remove, removeForEngagement };
