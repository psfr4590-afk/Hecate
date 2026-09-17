'use strict';

// Engagement-scoped event policy is dependency-free so it can be verified
// without requiring the WebSocket transport package.
const ENGAGEMENT_SCOPED_TYPES = new Set([
  'recon', 'mitm', 'evil-proxy', 'wireless', 'c2', 'delivery',
  'post-exploit', 'pivot', 'webapp', 'session', 'credential',
]);

function namespaceOf(type) {
  return typeof type === 'string' ? type.split(':', 1)[0] : '';
}

function engagementIdFromData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data.engagementId ?? data.engagement_id ?? data.eid ?? data.engagement?.id ?? null;
}

function requiresEngagement(type) {
  return ENGAGEMENT_SCOPED_TYPES.has(namespaceOf(type));
}

function shouldBroadcast(type, data) {
  return !requiresEngagement(type) || Boolean(engagementIdFromData(data));
}

module.exports = { engagementIdFromData, namespaceOf, requiresEngagement, shouldBroadcast };
