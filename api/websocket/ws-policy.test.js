'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./ws-policy');

test('engagementIdFromData accepts supported engagement field forms', () => {
  assert.equal(policy.engagementIdFromData({ engagementId: 'e1' }), 'e1');
  assert.equal(policy.engagementIdFromData({ engagement_id: 'e2' }), 'e2');
  assert.equal(policy.engagementIdFromData({ eid: 'e3' }), 'e3');
  assert.equal(policy.engagementIdFromData({ engagement: { id: 'e4' } }), 'e4');
  assert.equal(policy.engagementIdFromData({}), null);
});

test('engagement-sensitive events fail closed without an engagement identity', () => {
  assert.equal(policy.requiresEngagement('c2:checkin'), true);
  assert.equal(policy.shouldBroadcast('c2:checkin', {}), false);
  assert.equal(policy.shouldBroadcast('c2:checkin', { engagementId: 'e1' }), true);
});

test('global events remain broadcastable', () => {
  assert.equal(policy.requiresEngagement('core:ready'), false);
  assert.equal(policy.shouldBroadcast('core:ready', {}), true);
});
