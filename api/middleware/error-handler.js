'use strict';

/**
 * HECATE — Centralized Error Handler
 * Must be registered LAST in the middleware chain (4-argument signature).
 * Always returns { error: { code, message, detail? } } — never leaks stacks.
 */

const KNOWN_CODES = new Map([
  ['HECATE_NOT_FOUND',      404],
  ['HECATE_FORBIDDEN',      403],
  ['HECATE_UNAUTHORIZED',   401],
  ['HECATE_BAD_INPUT',      400],
  ['HECATE_CONFLICT',       409],
  ['HECATE_RATE_LIMITED',   429],
]);

/**
 * Structured error helper — throw these from routes for clean responses.
 * @example throw new HecateError('HECATE_NOT_FOUND', 'Engagement not found')
 */
class HecateError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name    = 'HecateError';
    this.code    = code;
    this.detail  = detail;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isProd = process.env.NODE_ENV === 'production';

  // HecateError — known, operator-safe
  if (err instanceof HecateError || KNOWN_CODES.has(err.code)) {
    const status = KNOWN_CODES.get(err.code) ?? 400;
    return res.status(status).json({
      error: {
        code:    err.code    ?? 'HECATE_ERROR',
        message: err.message ?? 'Request failed.',
        detail:  err.detail  ?? undefined,
      }
    });
  }

  // SQLite constraint violations
  if (err.code === 'SQLITE_CONSTRAINT') {
    return res.status(409).json({
      error: { code: 'HECATE_CONFLICT', message: 'Database constraint violation.' }
    });
  }

  // Unexpected server error — log full detail, return minimal response
  process.stderr.write(JSON.stringify({
    ts:      new Date().toISOString(),
    type:    'unhandled_error',
    message: err.message,
    code:    err.code,
    stack:   err.stack,
    path:    req.path,
    method:  req.method,
  }) + '\n');

  return res.status(500).json({
    error: {
      code:    'INTERNAL_ERROR',
      message: isProd ? 'Internal server error.' : err.message,
    }
  });
}

module.exports = { errorHandler, HecateError };
