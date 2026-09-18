'use strict';

/**
 * Network/traffic policy primitives.
 *
 * These settings control assessment traffic volume and routing metadata.
 * They intentionally do not implement defensive-control bypasses or
 * target-specific evasion techniques.
 */

const MODES = Object.freeze(['passive', 'low-noise', 'normal', 'aggressive']);

const DEFAULTS = Object.freeze({
  mode: 'low-noise',
  concurrency: 4,
  requestsPerSecond: 2,
  maxRetries: 2,
  backoffMs: 1000,
  reuseConnections: true,
});

function integerAtLeast(value, fallback, minimum) {
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

function createTrafficProfile(input = {}) {
  const mode = String(input.mode || DEFAULTS.mode).toLowerCase();
  if (!MODES.includes(mode)) throw new TypeError(`Unknown traffic mode: ${mode}`);

  const concurrency = integerAtLeast(input.concurrency, DEFAULTS.concurrency, 1);
  const requestsPerSecond = Number.isFinite(input.requestsPerSecond) && input.requestsPerSecond > 0
    ? Number(input.requestsPerSecond)
    : DEFAULTS.requestsPerSecond;

  return Object.freeze({
    mode,
    concurrency,
    requestsPerSecond,
    maxRetries: integerAtLeast(input.maxRetries, DEFAULTS.maxRetries, 0),
    backoffMs: integerAtLeast(input.backoffMs, DEFAULTS.backoffMs, 0),
    reuseConnections: input.reuseConnections !== false,
    route: Object.freeze({
      proxy: input.route?.proxy ? String(input.route.proxy) : null,
      tunnel: input.route?.tunnel ? String(input.route.tunnel) : null,
      dns: input.route?.dns ? String(input.route.dns) : null,
    }),
  });
}

function nextBackoffMs(profile, retryNumber) {
  if (!Number.isInteger(retryNumber) || retryNumber < 1) return 0;
  return profile.backoffMs * Math.pow(2, retryNumber - 1);
}

function shouldBackoff(statusCode) {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 ||
    (Number.isInteger(statusCode) && statusCode >= 500 && statusCode <= 599);
}

module.exports = {
  MODES,
  DEFAULTS,
  createTrafficProfile,
  nextBackoffMs,
  shouldBackoff,
};
