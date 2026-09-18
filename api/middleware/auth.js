`use strict`;

/**
 * HECATE — Auth Middleware
 * REST authentication supports the configured API token for programmatic
 * clients and an HttpOnly, process-scoped browser session for the local UI.
 * Browser sessions are minted only by the same local server that serves the UI.
 */

const crypto = require('crypto');
const { operatorId } = require('../../core/auth/principal');

const PUBLIC_ROUTES = new Set(['/health']);
const EXPECTED_TOKEN = process.env.HECATE_API_TOKEN ?? '';
const SESSION_COOKIE = 'hecate_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_SECRET = crypto.randomBytes(32);

if (!EXPECTED_TOKEN) {
  process.stderr.write(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'warn',
    message: 'HECATE_API_TOKEN is not set — token-authenticated API clients will be rejected',
  }) + '\n');
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.concat([aBuf, Buffer.alloc(len - aBuf.length)]);
  const bPad = Buffer.concat([bBuf, Buffer.alloc(len - bBuf.length)]);
  return crypto.timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

function signSession(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function issueSessionCookie(options = {}) {
  const expiresAt = Number.isFinite(options.expiresAt) ? options.expiresAt : Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({
    nonce: crypto.randomBytes(32).toString('base64url'),
    exp: expiresAt,
  })).toString('base64url');
  return `${payload}.${signSession(payload)}`;
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function validSessionCookie(value) {
  if (typeof value !== 'string') return false;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!safeEqual(signature, signSession(payload))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof parsed?.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

function hasLocalSession(req) {
  return validSessionCookie(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

function sessionSetCookieHeader() {
  return `${SESSION_COOKIE}=${issueSessionCookie()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function auth(req, res, next) {
  if (PUBLIC_ROUTES.has(req.path)) return next();

  let authenticated = false;
  let token = null;

  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7).trim();
  if (!token) token = req.headers['x-hecate-token'] ?? null;

  if (token && safeEqual(token, EXPECTED_TOKEN)) {
    authenticated = true;
  } else if (hasLocalSession(req)) {
    authenticated = true;
  }

  if (!authenticated) {
    return res.status(401).json({
      error: { code: 'HECATE_UNAUTHORIZED', message: 'Valid API token or local browser session required.' }
    });
  }

  req.hecateOperatorId = operatorId();
  req.hecateToken = token ? token.slice(0, 8) + '…' : 'local-session';
  next();
}

module.exports = auth;
module.exports.SESSION_COOKIE = SESSION_COOKIE;
module.exports.SESSION_TTL_MS = SESSION_TTL_MS;
module.exports.issueSessionCookie = issueSessionCookie;
module.exports.sessionSetCookieHeader = sessionSetCookieHeader;
module.exports.hasLocalSession = hasLocalSession;
module.exports.validSessionCookie = validSessionCookie;
module.exports.parseCookies = parseCookies;
