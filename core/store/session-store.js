'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../db/database').get();

function create({ engagementId, module: mod, targetId, transport, metadata }) {
  const id = randomUUID();
  db().prepare("INSERT INTO sessions (id,engagement_id,module,target_id,transport,metadata,last_seen) VALUES (?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
    .run(id, engagementId, mod, targetId ?? null, transport ?? null, metadata ? JSON.stringify(metadata) : null);
  return id;
}

function findById(id) { return db().prepare('SELECT * FROM sessions WHERE id=?').get(id) ?? null; }
function findByIdForEngagement(id, engagementId) { return db().prepare('SELECT * FROM sessions WHERE id=? AND engagement_id=?').get(id, engagementId) ?? null; }
function findByEngagement(eid) { return db().prepare("SELECT * FROM sessions WHERE engagement_id=? ORDER BY created_at DESC").all(eid); }
function listActive() { return db().prepare("SELECT * FROM sessions WHERE status='active' ORDER BY last_seen DESC").all(); }
function listActiveForOperator(operatorId) { return db().prepare(`SELECT s.* FROM sessions s INNER JOIN engagement_operators eo ON eo.engagement_id=s.engagement_id WHERE eo.operator_id=? AND s.status='active' ORDER BY s.last_seen DESC`).all(operatorId); }

function heartbeatForEngagement(id, engagementId) {
  const r = db().prepare("UPDATE sessions SET last_seen=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND engagement_id=?").run(id, engagementId);
  return r.changes > 0;
}

function heartbeat(id) {
  const r = db().prepare("UPDATE sessions SET last_seen=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id);
  return r.changes > 0;
}

function setInactiveForEngagement(id, engagementId) { return db().prepare("UPDATE sessions SET status='inactive' WHERE id=? AND engagement_id=?").run(id, engagementId); }
function setDeadForEngagement(id, engagementId) { return db().prepare("UPDATE sessions SET status='dead' WHERE id=? AND engagement_id=?").run(id, engagementId); }
function updateMetadataForEngagement(id, engagementId, metadata) { return db().prepare('UPDATE sessions SET metadata=? WHERE id=? AND engagement_id=?').run(JSON.stringify(metadata), id, engagementId); }
function removeForEngagement(id, engagementId) { return db().prepare('DELETE FROM sessions WHERE id=? AND engagement_id=?').run(id, engagementId); }

function setInactive(id) { db().prepare("UPDATE sessions SET status='inactive' WHERE id=?").run(id); }
function setDead(id)     { db().prepare("UPDATE sessions SET status='dead'     WHERE id=?").run(id); }

function updateMetadata(id, metadata) {
  db().prepare('UPDATE sessions SET metadata=? WHERE id=?').run(JSON.stringify(metadata), id);
}

function remove(id) { db().prepare('DELETE FROM sessions WHERE id=?').run(id); }

module.exports = { create, findById, findByIdForEngagement, findByEngagement, listActive, listActiveForOperator, heartbeat, heartbeatForEngagement, setInactive, setInactiveForEngagement, setDead, setDeadForEngagement, updateMetadata, updateMetadataForEngagement, remove, removeForEngagement };
