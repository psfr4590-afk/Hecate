'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../database').get();

function findById(id) {
  return db().prepare('SELECT * FROM targets WHERE id=?').get(id) ?? null;
}
function findByIdForEngagement(id, engagementId) {
  return db().prepare('SELECT * FROM targets WHERE id=? AND engagement_id=?').get(id, engagementId) ?? null;
}
function findByEngagement(eid) {
  return db().prepare('SELECT * FROM targets WHERE engagement_id=? ORDER BY created_at DESC').all(eid);
}
function upsert({ engagementId, type, value, label, metadata }) {
  const ex = db().prepare('SELECT id FROM targets WHERE engagement_id=? AND type=? AND value=?').get(engagementId, type, value);
  if (ex) {
    db().prepare("UPDATE targets SET label=?,metadata=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
      .run(label ?? null, metadata ?? null, ex.id);
    return ex.id;
  }
  const id = randomUUID();
  db().prepare('INSERT INTO targets (id,engagement_id,type,value,label,metadata) VALUES (?,?,?,?,?,?)')
    .run(id, engagementId, type, value, label ?? null, metadata ?? null);
  return id;
}
function updateForEngagement(id, engagementId, { label, metadata, status }) {
  return db().prepare("UPDATE targets SET label=?,metadata=?,status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND engagement_id=?")
    .run(label ?? null, metadata ?? null, status ?? 'active', id, engagementId);
}
function update(id, { label, metadata, status }) {
  db().prepare("UPDATE targets SET label=?,metadata=?,status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
    .run(label ?? null, metadata ?? null, status ?? 'active', id);
}
function removeForEngagement(id, engagementId) {
  return db().prepare('DELETE FROM targets WHERE id=? AND engagement_id=?').run(id, engagementId);
}
function remove(id) {
  db().prepare('DELETE FROM targets WHERE id=?').run(id);
}
module.exports = { findById, findByIdForEngagement, findByEngagement, upsert, update, updateForEngagement, remove, removeForEngagement };
