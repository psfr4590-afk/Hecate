'use strict';

/**
 * HECATE — Engagement Authorization
 *
 * REST authorization is engagement-scoped. Authentication identifies the
 * operator; this module decides whether that operator may access a resource.
 * Resource IDs are never treated as authorization.
 */

const Engagement = require('../db/models/engagement');
const { HecateError } = require('../../api/middleware/error-handler');

const { OPERATOR_ID: DEFAULT_OPERATOR_ID } = require('./principal');

function operatorId(req) {
  return DEFAULT_OPERATOR_ID;
}

function deny(message = 'Operator is not authorized for this engagement') {
  throw new HecateError('HECATE_FORBIDDEN', message);
}

function requireEngagement(req, engagementId) {
  const row = Engagement.findById(engagementId);
  if (!row) throw new HecateError('HECATE_NOT_FOUND', 'Engagement not found');
  if (!Engagement.isOperatorMember(engagementId, operatorId(req))) deny();
  return row;
}

function requireResource(req, row, label = 'Resource') {
  if (!row) throw new HecateError('HECATE_NOT_FOUND', `${label} not found`);
  const engagementId = row.engagement_id ?? row.engagementId;
  if (!engagementId) throw new HecateError('HECATE_FORBIDDEN', `${label} has no engagement scope`);
  requireEngagement(req, engagementId);
  return row;
}

function requireTargetInEngagement(req, targetId, engagementId) {
  if (!targetId) return null;
  const Target = require('../db/models/target');
  const target = Target.findByIdForEngagement(targetId, engagementId);
  if (!target) throw new HecateError('HECATE_NOT_FOUND', 'Target not found in engagement');
  requireEngagement(req, engagementId);
  return target;
}

module.exports = {
  DEFAULT_OPERATOR_ID,
  operatorId,
  requireEngagement,
  requireResource,
  requireTargetInEngagement,
};
