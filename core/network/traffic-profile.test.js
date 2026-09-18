'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTrafficProfile,
  nextBackoffMs,
  shouldBackoff,
} = require('./traffic-profile');

test('traffic profile defaults to low-noise adaptive settings', () => {
  const profile = createTrafficProfile();
  assert.equal(profile.mode, 'low-noise');
  assert.equal(profile.concurrency, 4);
  assert.equal(profile.requestsPerSecond, 2);
  assert.equal(profile.reuseConnections, true);
});

test('route metadata supports proxy, tunnel, and DNS selections', () => {
  const profile = createTrafficProfile({
    route: { proxy: 'proxy-a', tunnel: 'tunnel-a', dns: 'resolver-a' },
  });

  assert.equal(profile.route.proxy, 'proxy-a');
  assert.equal(profile.route.tunnel, 'tunnel-a');
  assert.equal(profile.route.dns, 'resolver-a');
});

test('retry backoff grows exponentially', () => {
  const profile = createTrafficProfile({ backoffMs: 250 });
  assert.equal(nextBackoffMs(profile, 1), 250);
  assert.equal(nextBackoffMs(profile, 2), 500);
  assert.equal(nextBackoffMs(profile, 3), 1000);
});

test('rate limiting and transient server responses trigger backoff', () => {
  assert.equal(shouldBackoff(429), true);
  assert.equal(shouldBackoff(503), true);
  assert.equal(shouldBackoff(404), false);
});
