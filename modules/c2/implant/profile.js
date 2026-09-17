'use strict';

/**
 * HECATE C2 — Implant Profiles
 * A profile defines the beacon behaviour, kill switches, and C2 endpoints
 * baked into an implant at generation time.
 *
 * Profiles are NOT the implant binary — they're the configuration that
 * would be embedded when an implant is compiled/generated.
 * HECATE tracks profiles so operators can reproduce or revoke implant configs.
 */

const { randomUUID } = require('crypto');

const DEFAULT_PROFILE = {
  sleepSec:       30,          // base beacon interval
  jitterPct:      20,          // ±% jitter applied to sleep
  maxMissed:      5,           // kill switch: self-terminate after N missed checkins
  userAgent:      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  c2Paths:        ['/c2/beacon', '/api/status', '/health'],  // rotate through these
  killDate:       null,        // ISO date after which implant self-terminates
  proxyUrl:       null,        // optional HTTP proxy for implant egress
  transport:      'https',     // https | dns | icmp (dns/icmp = future)
};

// In-memory profile store — profiles are also persisted to c2-store
const profiles = new Map();

/**
 * Create a new implant profile.
 * @param {object} opts  - overrides for DEFAULT_PROFILE
 * @returns {ImplantProfile}
 */
function create(opts = {}) {
  const id = randomUUID();
  const profile = {
    id,
    ...DEFAULT_PROFILE,
    ...opts,
    createdAt: new Date().toISOString(),
  };
  profiles.set(id, profile);
  return profile;
}

function get(id) {
  return profiles.get(id) ?? null;
}

function list() {
  return [...profiles.values()];
}

function remove(id) {
  return profiles.delete(id);
}

function clear() {
  profiles.clear();
}

/**
 * Validate a profile object.
 * @throws on invalid field values
 */
function validate(p) {
  if (p.sleepSec < 1 || p.sleepSec > 86400) {
    throw new Error('sleepSec must be between 1 and 86400');
  }
  if (p.jitterPct < 0 || p.jitterPct > 100) {
    throw new Error('jitterPct must be between 0 and 100');
  }
  if (!['https', 'dns', 'icmp'].includes(p.transport)) {
    throw new Error(`Unknown transport: ${p.transport}`);
  }
  if (p.killDate && isNaN(Date.parse(p.killDate))) {
    throw new Error(`Invalid killDate: ${p.killDate}`);
  }
  if (!Array.isArray(p.c2Paths) || p.c2Paths.length === 0) {
    throw new Error('c2Paths must be a non-empty array');
  }
}

/**
 * Calculate actual sleep duration with jitter applied.
 * Used server-side to predict next expected checkin.
 * @param {number} sleepSec
 * @param {number} jitterPct
 * @returns {{ minMs, maxMs, nominalMs }}
 */
function sleepRange(sleepSec, jitterPct) {
  const nominalMs = sleepSec * 1000;
  const deltaMs   = nominalMs * (jitterPct / 100);
  return {
    nominalMs,
    minMs: nominalMs - deltaMs,
    maxMs: nominalMs + deltaMs,
  };
}

module.exports = { DEFAULT_PROFILE, create, get, list, remove, clear, validate, sleepRange };
