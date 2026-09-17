'use strict';

/**
 * HECATE — Sliding Window Rate Limiter
 * In-memory, no external deps. Keyed by API token or IP fallback.
 * Automatically prunes expired windows on each check.
 */

const DEFAULT_WINDOW_MS = 60_000;   // 1 minute
const DEFAULT_MAX        = 120;     // requests per window
const PRUNE_INTERVAL_MS  = 300_000; // prune stale keys every 5 min

// Map<key, number[]> — timestamps of requests within current window
const windows = new Map();

// Periodic cleanup of idle keys
const pruner = setInterval(() => {
  const cutoff = Date.now() - DEFAULT_WINDOW_MS;
  for (const [key, times] of windows) {
    const remaining = times.filter(t => t > cutoff);
    if (remaining.length === 0) windows.delete(key);
    else windows.set(key, remaining);
  }
}, PRUNE_INTERVAL_MS).unref(); // .unref() so it doesn't keep the process alive

/**
 * Factory — returns an Express middleware with custom limits.
 * @param {object} opts
 * @param {number} opts.windowMs   - sliding window in ms (default 60 000)
 * @param {number} opts.max        - max requests per window (default 120)
 * @param {string} opts.message    - custom error message
 */
function rateLimitMiddleware(opts = {}) {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const max      = opts.max      ?? DEFAULT_MAX;
  const message  = opts.message  ?? 'Too many requests — slow down.';

  return function rateLimit(req, res, next) {
    // Key: prefer token identity over IP (token is already authenticated)
    const key = req.hecateToken ?? req.ip ?? 'unknown';

    const now    = Date.now();
    const cutoff = now - windowMs;

    // Get existing window, prune expired entries
    let times = (windows.get(key) ?? []).filter(t => t > cutoff);

    if (times.length >= max) {
      const oldest  = times[0];
      const resetMs = windowMs - (now - oldest);
      res.set('Retry-After', Math.ceil(resetMs / 1000));
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message, resetMs }
      });
    }

    times.push(now);
    windows.set(key, times);

    // Expose rate limit headers
    res.set('X-RateLimit-Limit',     max);
    res.set('X-RateLimit-Remaining', max - times.length);
    res.set('X-RateLimit-Reset',     Math.ceil((times[0] + windowMs) / 1000));

    next();
  };
}

// Default export: standard limits
module.exports = rateLimitMiddleware();

// Named export: factory for custom limits
module.exports.create = rateLimitMiddleware;
