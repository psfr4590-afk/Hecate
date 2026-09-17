'use strict';

/**
 * HECATE — Auth Middleware
 * Accepts: Authorization: Bearer <token>  OR  X-Hecate-Token: <token>
 * Constant-time comparison — no timing oracle.
 * Token source: HECATE_API_TOKEN env var (required at startup).
 * Public routes bypass auth entirely.
 */

const crypto = require('crypto');
const { operatorId } = require('../../core/auth/principal');

// Routes that don't require a token
const PUBLIC_ROUTES = new Set(['/health']);

// Token loaded once at module init — fail fast if missing
const EXPECTED_TOKEN = process.env.HECATE_API_TOKEN ?? '';

if (!EXPECTED_TOKEN) {
  process.stderr.write(JSON.stringify({
    ts:      new Date().toISOString(),
    level:   'warn',
    message: 'HECATE_API_TOKEN is not set — all API requests will be rejected',
  }) + '\n');
}

/**
 * Constant-time string comparison using crypto.timingSafeEqual.
 * Pads both sides to the same length to avoid length-based timing leak.
 */
function safeEqual(a, b) {
  // Both must be strings; empty expected = always fail
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // Pad shorter buffer to match length (comparison still runs full length)
  const len  = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.concat([aBuf, Buffer.alloc(len - aBuf.length)]);
  const bPad = Buffer.concat([bBuf, Buffer.alloc(len - bBuf.length)]);
  return crypto.timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}

function auth(req, res, next) {
  // Public routes bypass auth
  if (PUBLIC_ROUTES.has(req.path)) return next();

  // Extract token from either header
  let token = null;

  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    token = req.headers['x-hecate-token'] ?? null;
  }

  if (!token || !safeEqual(token, EXPECTED_TOKEN)) {
    return res.status(401).json({
      error: { code: 'HECATE_UNAUTHORIZED', message: 'Valid API token required.' }
    });
  }

  // Establish an explicit operator principal. The token authenticates the
  // request; engagement authorization is enforced separately.
  req.hecateOperatorId = operatorId();

  // Expose token identity for rate limiter keying
  req.hecateToken = token.slice(0, 8) + '…'; // safe prefix — not the full token
  next();
}

module.exports = auth;
