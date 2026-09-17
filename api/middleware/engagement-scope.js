'use strict';

const { requireEngagement, requireResource } = require('../../core/auth/authorization');

function requireQueryEngagement(req) {
  return requireEngagement(req, req.query?.eid ?? req.query?.engagementId);
}

function requireBodyEngagement(req) {
  return requireEngagement(req, req.body?.engagementId ?? req.body?.eid);
}

function requireResourceEngagement(req, row, label) {
  return requireResource(req, row, label);
}

module.exports = { requireQueryEngagement, requireBodyEngagement, requireResourceEngagement };
