'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const targetStore = require('./target/target-store');
const campaignManager = require('./campaign/campaign-manager');
const sendQueue = require('./send/send-queue');

const db = new DatabaseSync(':memory:');
targetStore.init(db);
campaignManager.init(db);
sendQueue.init(db);

after(() => db.close());

test('delivery campaign, targets, and tracking events survive store reinitialisation', () => {
  const template = { subject: 'Hello {{first_name}}', htmlBody: '<body>{{tracking_id}}</body>' };
  const campaign = campaignManager.create({
    engagementId: 'eng-persist',
    name: 'Persistent campaign',
    template,
    trackingBase: 'https://example.test',
  });
  const { added } = campaignManager.addTargets(campaign.id, [{ email: 'persist@example.test', first_name: 'Persist' }]);
  assert.equal(added, 1);

  const target = targetStore.listByCampaign(campaign.id)[0];
  targetStore.recordEvent(target.trackingId, 'sent', { ip: '127.0.0.1' });
  targetStore.recordEvent(target.trackingId, 'open', { ip: '127.0.0.1' });

  // Rebuild the runtime caches against the same database, simulating restart.
  targetStore.init(db);
  campaignManager.init(db);
  sendQueue.init(db);

  const restored = campaignManager.get(campaign.id);
  assert.equal(restored.engagementId, 'eng-persist');
  assert.deepEqual(restored.template, template);

  const targets = targetStore.listByCampaign(campaign.id);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].email, 'persist@example.test');
  assert.equal(targets[0].state, 'opened');

  const full = targetStore.getByTracking(target.trackingId);
  assert.equal(full.events.length, 2);
  assert.equal(full.events[0].type, 'sent');
  assert.equal(full.events[1].type, 'open');
});
