'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dnsSpoofer = require('./dns-spoofer');

before(async () => { await dnsSpoofer.stop(); });
after(async () => { await dnsSpoofer.stop(); });

test('DNS runtime cannot be claimed by a second engagement while owned', () => {
  dnsSpoofer.setEngagement('eng-a');
  assert.throws(() => dnsSpoofer.setEngagement('eng-b'), /already owned by another engagement/);
  assert.doesNotThrow(() => dnsSpoofer.setEngagement('eng-a'));
});

test('DNS ownership is released when the runtime stops', async () => {
  await dnsSpoofer.stop();
  dnsSpoofer.setEngagement('eng-a');
  await dnsSpoofer.stop();
  assert.doesNotThrow(() => dnsSpoofer.setEngagement('eng-b'));
});
