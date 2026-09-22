'use strict';
const { randomUUID } = require('crypto');
const db         = () => require('../db/database').get();
const KeyManager = require('../crypto/key-manager');
const eventBus = require('../events/event-bus');

function list(engagementId) {
  const rows = engagementId
    ? db().prepare('SELECT id,engagement_id,type,username,target_id,metadata,created_at FROM credentials WHERE engagement_id=? ORDER BY created_at DESC').all(engagementId)
    : db().prepare('SELECT id,engagement_id,type,username,target_id,metadata,created_at FROM credentials ORDER BY created_at DESC').all();
  return rows; // secret_enc intentionally excluded from safe list
}

async function store({ engagementId, type, username, secret, targetId, metadata }) {
  const id        = randomUUID();
  const secretEnc = await KeyManager.encrypt(secret);
  require('../db/database').transaction(database => {
    database.prepare('INSERT INTO credentials (id,engagement_id,type,username,secret_enc,target_id,metadata) VALUES (?,?,?,?,?,?,?)')
      .run(id, engagementId, type, username ?? null, secretEnc, targetId ?? null, metadata ? JSON.stringify(metadata) : null);
    eventBus.emit('credential:created', { engagementId, subject: id, credentialId: id, type, username, targetId });
  });
  return id;
}

async function retrieve(id) {
  const row = db().prepare('SELECT * FROM credentials WHERE id=?').get(id);
  if (!row) return null;
  const secret = await KeyManager.decrypt(row.secret_enc);
  return { ...row, secret, secret_enc: undefined };
}

function remove(id) {
  const row = db().prepare('SELECT id FROM credentials WHERE id=?').get(id);
  if (!row) return false;
  require('../db/database').transaction(database => {
    database.prepare('DELETE FROM credentials WHERE id=?').run(id);
    eventBus.emit('credential:deleted', { subject: id, credentialId: id });
  });
  return true;
}

module.exports = { list, store, retrieve, remove };
