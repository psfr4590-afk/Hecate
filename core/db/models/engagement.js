'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../database').get();
const eventBus = require('../../events/event-bus');

function list(operatorId) {
  if (!operatorId) return db().prepare('SELECT * FROM engagements ORDER BY created_at DESC').all();
  return db().prepare(`
    SELECT e.* FROM engagements e
    INNER JOIN engagement_operators eo ON eo.engagement_id=e.id
    WHERE eo.operator_id=?
    ORDER BY e.created_at DESC
  `).all(operatorId);
}
function findById(id) { return db().prepare('SELECT * FROM engagements WHERE id=?').get(id) ?? null; }
function isOperatorMember(engagementId, operatorId) { if (!engagementId || !operatorId) return false; return !!db().prepare('SELECT 1 FROM engagement_operators WHERE engagement_id=? AND operator_id=? LIMIT 1').get(engagementId, operatorId); }
function addOperator(engagementId, operatorId, role = 'operator') { if (!findById(engagementId)) return false; db().prepare('INSERT INTO engagement_operators (engagement_id, operator_id, role) VALUES (?, ?, ?) ON CONFLICT(engagement_id, operator_id) DO UPDATE SET role=excluded.role').run(engagementId, operatorId, role); return true; }
function create({ name, description, scope, status, ownerOperatorId }) {
  const id=randomUUID(), owner=ownerOperatorId||process.env.HECATE_OPERATOR_ID||'local-operator', database=db();
  try { database.exec('BEGIN'); database.prepare('INSERT INTO engagements (id,name,description,scope,status) VALUES (?,?,?,?,?)').run(id,name,description??null,scope??null,status??'active'); addOperator(id,owner,'owner'); database.exec('COMMIT'); eventBus.emit('engagement:created',{engagementId:id,subject:id,name}); return id; }
  catch(err){try{database.exec('ROLLBACK')}catch{} throw err;}
}
function update(id, fields) { const sets=[],vals=[]; for(const k of ['name','description','scope','status']) if(fields[k]!==undefined){sets.push(`${k}=?`);vals.push(fields[k]);} if(!sets.length)return; sets.push("updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"); vals.push(id); db().prepare(`UPDATE engagements SET ${sets.join(',')} WHERE id=?`).run(...vals); eventBus.emit('engagement:updated',{engagementId:id,subject:id,changes:Object.keys(fields).filter(k=>fields[k]!==undefined)}); }
function remove(id){ const row=findById(id); const result=db().prepare('DELETE FROM engagements WHERE id=?').run(id); if(result.changes) eventBus.emit('engagement:deleted',{engagementId:id,subject:id,name:row?.name}); return result; }
module.exports={list,findById,isOperatorMember,addOperator,create,update,remove};