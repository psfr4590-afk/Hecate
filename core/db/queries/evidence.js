'use strict';
const db = () => require('../database').get();
function countByType(engagementId) {
  return db().prepare('SELECT type, COUNT(*) as n FROM evidence WHERE engagement_id=? GROUP BY type').all(engagementId);
}
module.exports = { countByType };
