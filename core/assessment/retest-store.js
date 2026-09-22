'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../db/database').get();
const eventBus = require('../events/event-bus');
const STATUSES = new Set(['pending', 'passed', 'failed', 'inconclusive']);

function listForFinding(findingId, engagementId) {
  return db().prepare('SELECT * FROM finding_retests WHERE finding_id=? AND engagement_id=? ORDER BY created_at DESC').all(findingId, engagementId);
}
function create({ engagementId, findingId, notes, evidenceId }) { return require('../db/database').transaction(database=>{ const id = randomUUID(); database.prepare('INSERT INTO finding_retests (id,engagement_id,finding_id,status,notes,evidence_id) VALUES (?,?,?,?,?,?)').run(id, engagementId, findingId, 'pending', notes ?? null, evidenceId ?? null); eventBus.emit('finding:retest_created', { engagementId, subject: findingId, findingId, retestId: id }); return findById(id, engagementId); }); }
function findById(id, engagementId) {
  return db().prepare('SELECT * FROM finding_retests WHERE id=? AND engagement_id=?').get(id, engagementId) ?? null;
}
function complete(id, engagementId, status, notes) {
  if (!STATUSES.has(status) || status === 'pending') throw new TypeError('Invalid retest status');
  const row = findById(id, engagementId);
  if (!row) return null;
  return require('../db/database').transaction(database=>{ database.prepare("UPDATE finding_retests SET status=?,notes=COALESCE(?,notes),completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND engagement_id=?").run(status, notes ?? null, id, engagementId); eventBus.emit('finding:retest_completed', { engagementId, subject: row.finding_id, findingId: row.finding_id, retestId: id, status }); return findById(id, engagementId); });
}
module.exports = { STATUSES, listForFinding, create, findById, complete };
