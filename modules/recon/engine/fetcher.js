'use strict';

/**
 * HECATE Recon — Stealth Fetcher
 * Wraps Node 22's built-in fetch() with:
 *   - Stealth profile headers
 *   - Per-domain rate limiting
 *   - Configurable retry with exponential backoff
 *   - Redirect tracking (records redirect chain)
 *   - Response body size cap (avoid RAM bombs)
 *   - Timeout enforcement
 *   - TLS verification control (red team sometimes needs off)
 */

const profiles     = require('../stealth/profiles');
const RateLimiter  = require('../stealth/rate-limiter');
const ssrfGuard    = require('../target/ssrf-guard');

const DEFAULT_TIMEOUT_MS   = 15_000;
const DEFAULT_MAX_RETRIES  = 2;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB

class Fetcher {
  /**
   * @param {object} opts
   * @param {string}  opts.profile         - stealth profile name
   * @param {number}  opts.timeoutMs
   * @param {number}  opts.maxRetries
   * @param {number}  opts.maxBodyBytes
   * @param {boolean} opts.verifyTls       - false to skip cert verification
   * @param {boolean} opts.applyJitter     - sleep profile jitter between requests
   * @param {object}  opts.rateLimiter     - DomainRateLimiter instance (shared)
   * @param {object}  opts.extraHeaders    - additional headers for every request
   * @param {string}  opts.proxyUrl        - optional HTTP proxy URL
   * @param {boolean} opts.allowPrivateTargets - explicitly allow private/special-use destinations
   */
  constructor(opts = {}) {
    this.profile       = opts.profile      ?? profiles.DEFAULT_PROFILE;
    this.timeoutMs     = opts.timeoutMs    ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries    = opts.maxRetries   ?? DEFAULT_MAX_RETRIES;
    this.maxBodyBytes  = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.verifyTls     = opts.verifyTls    ?? true;
    this.applyJitter   = opts.applyJitter  ?? true;
    this.extraHeaders  = opts.extraHeaders ?? {};
    this.proxyUrl      = opts.proxyUrl     ?? null;
    this.allowPrivateTargets = opts.allowPrivateTargets ?? false;
    this.maxRedirects  = opts.maxRedirects ?? 5;
    this.followRedirects = opts.followRedirects ?? true;
    this.rateLimiter   = opts.rateLimiter  ?? new RateLimiter({ ratePerSec: 0.5, burst: 3 });

    // Stats
    this.stats = { fetched: 0, errors: 0, retries: 0, bytes: 0 };
  }

  /**
   * Fetch a URL.
   * @param {string} url
   * @param {object} fetchOpts  - additional per-request options (method, headers, body)
   * @returns {FetchResult}
   */
  async fetch(url, fetchOpts = {}) {
    const allowPrivate = fetchOpts.allowPrivateTargets ?? this.allowPrivateTargets;
    await ssrfGuard.validateUrl(url, { allowPrivate });
    const hostname = new URL(url).hostname;

    // Rate limit — wait for token
    await this.rateLimiter.acquire(hostname);

    // Jitter
    if (this.applyJitter) {
      await profiles.applyJitter(this.profile);
    }

    const headers = profiles.buildHeaders(this.profile, {
      ...this.extraHeaders,
      ...(fetchOpts.headers ?? {}),
    });

    const method = fetchOpts.method ?? 'GET';

    // Build fetch options
    const reqOpts = {
      method,
      headers,
      redirect:        'manual',
      signal:          AbortSignal.timeout(this.timeoutMs),
      ...(fetchOpts.body ? { body: fetchOpts.body } : {}),
    };

    // TLS: Node 22 experimental — skip for now, noted as future config
    // (NODE_TLS_REJECT_UNAUTHORIZED handled at process level if needed)

    let attempt  = 0;
    let lastError;
    let redirectChain = [];
    let currentUrl = url;
    let redirects = 0;

    while (attempt <= this.maxRetries) {
      if (attempt > 0) {
        this.stats.retries++;
        const backoffMs = 1000 * (2 ** (attempt - 1));
        await profiles.sleep(backoffMs);
      }

      try {
        const res = await fetch(currentUrl, reqOpts);

        if (res.status >= 300 && res.status < 400 && res.headers.get('location') && this.followRedirects) {
          if (redirects >= this.maxRedirects) throw new Error('Maximum redirect count exceeded');
          const nextUrl = new URL(res.headers.get('location'), currentUrl).toString();
          await ssrfGuard.validateUrl(nextUrl, { allowPrivate });
          redirectChain.push({ from: currentUrl, to: nextUrl, status: res.status });
          currentUrl = nextUrl;
          redirects++;
          attempt = 0;
          continue;
        }

        // Read body with size cap
        const { body, truncated, bytes } = await this._readBody(res);

        this.stats.fetched++;
        this.stats.bytes += bytes;

        return {
          ok:            res.ok,
          url:           currentUrl,
          originalUrl:   url,
          status:        res.status,
          statusText:    res.statusText,
          headers:       Object.fromEntries(res.headers.entries()),
          body,
          bytes,
          truncated,
          redirectChain,
          error:         null,
        };

      } catch (err) {
        lastError = err;
        // Don't retry on 4xx/5xx — only on network errors / timeouts
        if (err.name === 'AbortError') break; // timeout — don't retry
        attempt++;
      }
    }

    this.stats.errors++;
    return {
      ok:          false,
      url: currentUrl,
      originalUrl: url,
      status:      null,
      statusText:  null,
      headers:     {},
      body:        null,
      bytes:       0,
      truncated:   false,
      redirectChain,
      error:       lastError?.message ?? 'Unknown fetch error',
    };
  }

  async _readBody(res) {
    const reader  = res.body?.getReader();
    if (!reader) return { body: '', truncated: false, bytes: 0 };

    const chunks = [];
    let total    = 0;
    let truncated = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBodyBytes) {
        truncated = true;
        reader.cancel();
        break;
      }
      chunks.push(value);
    }

    const buf  = Buffer.concat(chunks.map(c => Buffer.from(c)));
    const body = buf.toString('utf8');
    return { body, truncated, bytes: total };
  }
}

module.exports = Fetcher;
