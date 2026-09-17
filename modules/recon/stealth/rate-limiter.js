'use strict';

/**
 * HECATE Recon — Per-Domain Rate Limiter
 * Token bucket per hostname. Ensures crawl traffic respects configured
 * request rates. Default: 1 request / 2 seconds per domain.
 *
 * Not async-blocking globally — callers await acquire(host) individually.
 */

class TokenBucket {
  constructor(ratePerSec, burst) {
    this.ratePerSec = ratePerSec;       // tokens added per second
    this.burst      = burst;            // max tokens in bucket
    this.tokens     = burst;            // current tokens
    this.lastRefill = Date.now();
  }

  /** Refill tokens based on elapsed time */
  _refill() {
    const now     = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens   = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
    this.lastRefill = now;
  }

  /** Returns ms to wait, or 0 if token available now */
  tryConsume() {
    this._refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    // How long until we have 1 token?
    return Math.ceil((1 - this.tokens) / this.ratePerSec * 1000);
  }
}

class DomainRateLimiter {
  constructor(opts = {}) {
    this.ratePerSec = opts.ratePerSec ?? 0.5;  // default: 1 req per 2s
    this.burst      = opts.burst      ?? 3;    // allow short bursts
    this.buckets    = new Map();               // hostname → TokenBucket
  }

  _bucket(hostname) {
    if (!this.buckets.has(hostname)) {
      this.buckets.set(hostname, new TokenBucket(this.ratePerSec, this.burst));
    }
    return this.buckets.get(hostname);
  }

  /**
   * Acquire a token for hostname. Awaits if rate limit hit.
   */
  async acquire(hostname) {
    const bucket = this._bucket(hostname);
    const waitMs = bucket.tryConsume();
    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs));
      bucket.tryConsume(); // consume after wait
    }
  }

  stats() {
    const out = {};
    for (const [host, b] of this.buckets) {
      out[host] = { tokens: +b.tokens.toFixed(2), ratePerSec: b.ratePerSec };
    }
    return out;
  }

  reset(hostname) {
    this.buckets.delete(hostname);
  }

  clear() {
    this.buckets.clear();
  }
}

module.exports = DomainRateLimiter;
