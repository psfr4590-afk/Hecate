'use strict';
const db = () => require('../database').get();

function search({ q, engagementId, type }) {
  let sql = 'SELECT * FROM targets WHERE 1=1';
  const args = [];
  if (engagementId) { sql += ' AND engagement_id=?'; args.push(engagementId); }
  if (type)         { sql += ' AND type=?';          args.push(type); }
  if (q)            { sql += ' AND (value LIKE ? OR label LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  return db().prepare(sql).all(...args);
}

function searchForOperator({ q, type, operatorId }) {
  let sql = `
    SELECT t.* FROM targets t
    INNER JOIN engagement_operators eo ON eo.engagement_id=t.engagement_id
    WHERE eo.operator_id=?`;
  const args = [operatorId];
  if (type) { sql += ' AND t.type=?'; args.push(type); }
  if (q) { sql += ' AND (t.value LIKE ? OR t.label LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY t.created_at DESC LIMIT 500';
  return db().prepare(sql).all(...args);
}

module.exports = { search, searchForOperator };
