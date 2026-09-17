'use strict';

/**
 * HECATE Recon — Crawl Frontier
 * Priority queue + visited set. Enforces scope and depth limits.
 *
 * Priority: lower number = higher priority.
 * Default priorities:
 *   0 — seed URLs (operator-specified)
 *   1 — same-origin HTML links
 *   2 — same-origin assets (JS, CSS)
 *   3 — subdomains (if allowed)
 *   9 — out-of-scope (never enqueued)
 *
 * Scope rules (configurable):
 *   strict  — exact hostname only
 *   subdomain — hostname + all subdomains
 *   none    — no scope enforcement (operator knows what they're doing)
 */

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_QUEUE = 50_000;

class Frontier {
  /**
   * @param {object} opts
   * @param {string}   opts.seedHost          - primary target hostname
   * @param {string}   opts.scope             - 'strict' | 'subdomain' | 'none'
   * @param {number}   opts.maxDepth          - max crawl depth (default 5)
   * @param {number}   opts.maxQueue          - max queue size (default 50 000)
   * @param {string[]} opts.excludeExtensions - extensions to skip
   * @param {RegExp[]} opts.excludePatterns   - URL patterns to skip
   */
  constructor(opts = {}) {
    this.seedHost   = opts.seedHost   ?? '';
    this.scope      = opts.scope      ?? 'strict';
    this.maxDepth   = opts.maxDepth   ?? DEFAULT_MAX_DEPTH;
    this.maxQueue   = opts.maxQueue   ?? DEFAULT_MAX_QUEUE;

    this.excludeExtensions = new Set(
      (opts.excludeExtensions ?? [
        '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
        '.mp4', '.mp3', '.webm', '.woff', '.woff2', '.ttf', '.eot',
        '.zip', '.gz', '.tar', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
      ])
    );

    this.excludePatterns = opts.excludePatterns ?? [];

    // Priority queue: Array of { url, depth, priority, parentUrl }
    // Sorted ascending by priority on push (insertion sort — queue is small).
    this._queue   = [];
    this._visited = new Set();    // normalized URL strings
    this._queued  = new Set();    // URLs currently in queue (avoid re-add)
  }

  // ── Scope check ─────────────────────────────────────────────────────────────

  inScope(url) {
    if (this.scope === 'none') return true;
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    const h = parsed.hostname;
    if (this.scope === 'strict')    return h === this.seedHost;
    if (this.scope === 'subdomain') return h === this.seedHost || h.endsWith('.' + this.seedHost);
    return false;
  }

  // ── URL normalisation ────────────────────────────────────────────────────────

  normalize(url) {
    try {
      const u = new URL(url);
      u.hash = '';             // strip fragments
      // Sort query params for stable dedup
      u.searchParams.sort();
      return u.toString();
    } catch {
      return null;
    }
  }

  // ── Filtering ────────────────────────────────────────────────────────────────

  _shouldSkip(url) {
    const u = url.toLowerCase();
    const ext = u.split('?')[0].match(/\.[^./]+$/)?.[0];
    if (ext && this.excludeExtensions.has(ext)) return true;
    for (const re of this.excludePatterns) {
      if (re.test(url)) return true;
    }
    // Skip mailto:, tel:, javascript:
    if (/^(mailto:|tel:|javascript:|data:)/i.test(url)) return true;
    return false;
  }

  // ── Priority assignment ──────────────────────────────────────────────────────

  _priority(url, depth) {
    if (depth === 0) return 0;
    try {
      const u   = new URL(url);
      const ext = u.pathname.match(/\.[^./]+$/)?.[0]?.toLowerCase();
      if (['.js', '.json'].includes(ext)) return 2;  // juicy
      if (['.css'].includes(ext))         return 4;  // less juicy
      if (u.hostname !== this.seedHost)   return 3;  // subdomain
    } catch { /* ignore */ }
    return 1;
  }

  // ── Queue operations ─────────────────────────────────────────────────────────

  /**
   * Add a URL to the queue.
   * Returns true if enqueued, false if skipped/visited/out-of-scope.
   */
  push(url, depth = 1, parentUrl = null) {
    const norm = this.normalize(url);
    if (!norm)                         return false;
    if (this._visited.has(norm))       return false;
    if (this._queued.has(norm))        return false;
    if (depth > this.maxDepth)         return false;
    if (this._queue.length >= this.maxQueue) return false;
    if (this._shouldSkip(norm))        return false;
    if (!this.inScope(norm))           return false;

    const priority = this._priority(norm, depth);
    const entry    = { url: norm, depth, priority, parentUrl };

    // Insertion-sort by priority
    let i = this._queue.length;
    while (i > 0 && this._queue[i - 1].priority > priority) i--;
    this._queue.splice(i, 0, entry);
    this._queued.add(norm);
    return true;
  }

  /**
   * Seed the frontier with operator-specified URLs (priority 0).
   */
  seed(urls) {
    for (const url of urls) this.push(url, 0, null);
  }

  /**
   * Pop the highest-priority URL. Returns null if empty.
   */
  pop() {
    const entry = this._queue.shift();
    if (!entry) return null;
    this._queued.delete(entry.url);
    this._visited.add(entry.url);
    return entry;
  }

  markVisited(url) {
    const norm = this.normalize(url);
    if (norm) this._visited.add(norm);
  }

  get size()    { return this._queue.length; }
  get visited() { return this._visited.size; }
  isEmpty()     { return this._queue.length === 0; }

  stats() {
    return {
      queued:  this._queue.length,
      visited: this._visited.size,
      scope:   this.scope,
      maxDepth: this.maxDepth,
    };
  }
}

module.exports = Frontier;
