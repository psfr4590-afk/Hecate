'use strict';

/**
 * HECATE — Structured Request Logger
 * JSON output, duration tracking, auth header redaction.
 * Skips /health pings to avoid noise.
 */

const SKIP_PATHS = new Set(['/health', '/favicon.ico']);
const REDACT     = ['authorization', 'x-hecate-token', 'cookie', 'set-cookie'];

function redactHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT.includes(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

function logger(req, res, next) {
  if (SKIP_PATHS.has(req.path)) return next();

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const record = {
      ts:       new Date().toISOString(),
      method:   req.method,
      path:     req.path,
      query:    Object.keys(req.query).length ? Object.fromEntries(Object.entries(req.query).map(([k, v]) => /^(token|hecate_token|api_token)$/i.test(k) ? [k, '[REDACTED]'] : [k, v])) : undefined,
      status:   res.statusCode,
      ms:       +durationMs.toFixed(2),
      ip:       req.ip,
      ua:       req.headers['user-agent'],
      reqHdrs:  redactHeaders(req.headers),
    };

    // Errors get stderr, normal traffic gets stdout
    const stream = res.statusCode >= 500 ? process.stderr : process.stdout;
    stream.write(JSON.stringify(record) + '\n');
  });

  next();
}

module.exports = logger;
