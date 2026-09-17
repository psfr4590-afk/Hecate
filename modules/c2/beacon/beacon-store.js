'use strict';

/**
 * HECATE C2 — Beacon Store
 * In-memory registry of all implants that have ever checked in.
 * Tracks state, sysinfo, last-seen, and staleness.
 *
 * States:
 *   active   — checked in within expected sleep window
 *   stale    — missed ≥1 expected checkin
 *   dead     — sent die task or missed maxMissed checkins
 *   killed   — operator explicitly killed
 */

const { sleepRange } = require('../implant/profile');

// Map<implantId, Beacon>
const beacons = new Map();

let _eventBus = null;
function setEventBus(bus) { _eventBus = bus; }

const DEFAULT_SLEEP_SEC = 30;
const DEFAULT_JITTER    = 20;

/**
 * Register or update an implant's beacon record on checkin.
 * @param {string} implantId
 * @param {string} engagementId
 * @param {object} info          - from checkin message
 * @param {string} ip
 * @param {number} sleepSec
 * @param {number} jitterPct
 * @returns {Beacon}
 */
function checkin(implantId, engagementId, info, ip, sleepSec, jitterPct) {
  const sleep  = sleepSec  ?? DEFAULT_SLEEP_SEC;
  const jitter = jitterPct ?? DEFAULT_JITTER;
  const now    = Date.now();
  const range  = sleepRange(sleep, jitter);

  const existing = beacons.get(implantId);

  if (existing) {
    existing.info        = { ...existing.info, ...info };
    existing.ip          = ip ?? existing.ip;
    existing.lastSeen    = now;
    existing.missedCount = 0;
    existing.sleepSec    = sleep;
    existing.jitterPct   = jitter;
    existing.nextExpected = now + range.maxMs + 5000; // +5s grace
    existing.checkinCount++;
    if (existing.state === 'stale') existing.state = 'active';
    _emit('c2:checkin', { implantId, engagementId, state: existing.state });
    return existing;
  }

  const beacon = {
    implantId,
    engagementId,
    info:         info ?? {},
    ip:           ip ?? null,
    state:        'active',
    firstSeen:    now,
    lastSeen:     now,
    missedCount:  0,
    sleepSec:     sleep,
    jitterPct:    jitter,
    nextExpected: now + range.maxMs + 5000,
    checkinCount: 1,
  };

  beacons.set(implantId, beacon);
  _emit('c2:new_implant', { implantId, engagementId, info, ip });
  return beacon;
}

function get(implantId) {
  return beacons.get(implantId) ?? null;
}

function list({ engagementId, state } = {}) {
  return [...beacons.values()].filter(b => {
    if (engagementId && b.engagementId !== engagementId) return false;
    if (state        && b.state        !== state)        return false;
    return true;
  });
}

function kill(implantId) {
  const b = beacons.get(implantId);
  if (!b) return false;
  b.state = 'killed';
  _emit('c2:implant_killed', { implantId });
  return true;
}

/**
 * Mark stale implants — called periodically.
 * An implant is stale if now > nextExpected.
 */
function sweepStale() {
  const now = Date.now();
  for (const b of beacons.values()) {
    if (b.state !== 'active') continue;
    if (now > b.nextExpected) {
      b.missedCount++;
      b.state = b.missedCount >= 5 ? 'dead' : 'stale';
      _emit(b.state === 'dead' ? 'c2:implant_dead' : 'c2:implant_stale', {
        implantId: b.implantId, missedCount: b.missedCount
      });
    }
  }
}

function stats(engagementId = null) {
  const all  = [...beacons.values()].filter(b => !engagementId || b.engagementId === engagementId);
  const byState = {};
  for (const b of all) byState[b.state] = (byState[b.state] ?? 0) + 1;
  return { total: all.length, byState };
}

function clear() { beacons.clear(); }

function _emit(event, data) {
  _eventBus?.emit(event, { ...data, ts: new Date().toISOString() });
}

module.exports = { setEventBus, checkin, get, list, kill, sweepStale, stats, clear };
