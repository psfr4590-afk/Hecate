'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../db/database').get();
const { PHASES, createAssessmentPlan } = require('./assessment-plan');
const eventBus = require('../events/event-bus');

function get(engagementId) {
  const row = db().prepare('SELECT * FROM assessment_plans WHERE engagement_id=?').get(engagementId);
  if (!row) return null;
  return { id: row.id, engagementId: row.engagement_id, phases: JSON.parse(row.phases), options: JSON.parse(row.options), createdAt: row.created_at, updatedAt: row.updated_at };
}
function save(engagementId, input = {}) { return require('../db/database').transaction(()=>{
  const plan = createAssessmentPlan({ ...input, id: input.id || randomUUID() });
  const now = new Date().toISOString();
  db().prepare(`INSERT INTO assessment_plans (id,engagement_id,phases,options,created_at,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(engagement_id) DO UPDATE SET phases=excluded.phases,options=excluded.options,updated_at=excluded.updated_at`)
    .run(plan.id, engagementId, JSON.stringify(plan.phases), JSON.stringify(plan.options), now, now);
  const result = get(engagementId);
  eventBus.emit('assessment:plan_updated', { engagementId, subject: engagementId, phases: result.phases });
  return result;
}); }
module.exports = { PHASES, get, save };
