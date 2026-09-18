'use strict';

/**
 * HECATE Webapp — Scanner
 * Orchestrates the full webapp scan pipeline:
 *   Target → [Dir Fuzz + Param Fuzz + Header Fuzz] → Check Library → Findings
 *
 * Async worker pool — same concurrency model as modules/recon/engine/crawler.js.
 */

const { randomUUID } = require('crypto');

const wordlist    = require('./wordlist');
const { dirFuzz, paramFuzz, headerFuzz, isHit } = require('../checks/fuzzer');
const checks      = require('../checks/check-library');
const webappStore = require('../storage/webapp-store');
const ssrfGuard  = require('../../recon/target/ssrf-guard');

const activeScans = new Map();

const DEFAULT_CONFIG = {
  concurrency:    5,
  ratePerSec:     10,
  timeoutMs:      8_000,
  maxBodyBytes:   1 * 1024 * 1024,  // 1MB
  followRedirects: true,
  userAgent:      'HECATE-Webapp/1.0',
  dirFuzz:        true,
  paramFuzz:      true,
  headerFuzz:     true,
  checkList:      null,             // null = all checks
  wordlistFile:   null,             // path to custom wordlist
  extensions:     ['.php', '.asp', '.aspx', '.bak', '.old'],
  scope:          'path',           // path | host | domain
  allowPrivateTargets: false,
  maxRedirects:   5,
};

/**
 * Start a new webapp scan.
 * @param {object} opts
 * @param {string}   opts.engagementId
 * @param {string}   opts.targetId
 * @param {string}   opts.targetUrl   - base URL to scan
 * @param {object}   opts.config      - overrides for DEFAULT_CONFIG
 * @returns {string} scanId
 */
async function start(opts) {
  const { engagementId, targetId, targetUrl } = opts;
  const config = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };

  if (!targetUrl) throw new Error('targetUrl required');
  await ssrfGuard.validateUrl(targetUrl, { allowPrivate: config.allowPrivateTargets });

  const scanId = randomUUID();
  const cancel = { cancelled: false };

  webappStore.createScan({ id: scanId, engagementId, targetId, targetUrl, config });
  activeScans.set(scanId, { cancel, config, engagementId });

  // Run async — don't await
  _runScan(scanId, targetUrl, config, cancel, engagementId).catch(err => {
    webappStore.failScan(scanId, err.message);
  });

  return scanId;
}

function cancelScan(scanId) {
  const scan = activeScans.get(scanId);
  if (!scan) return false;
  scan.cancel.cancelled = true;
  webappStore.cancelScan(scanId);
  activeScans.delete(scanId);
  return true;
}

function listActive() { return [...activeScans.keys()]; }

async function shutdown() {
  for (const scanId of [...activeScans.keys()]) cancelScan(scanId);
}

// ── Scan runner ───────────────────────────────────────────────────────────────

async function _runScan(scanId, targetUrl, config, cancel, engagementId) {
  webappStore.startScan(scanId);

  const words = wordlist.get('dirs', config.wordlistFile);
  const all   = [];

  // Phase 1: Interesting files (always)
  for (const f of wordlist.INTERESTING_FILES) {
    const base = targetUrl.replace(/\/$/, '');
    all.push({ method: 'GET', url: `${base}/${f}`, fuzzTarget: 'interesting', payload: f });
  }

  // Phase 2: Dir fuzz
  if (config.dirFuzz) {
    all.push(...dirFuzz(targetUrl, { words, extensions: config.extensions }));
  }

  // Phase 3: Param fuzz on the root URL
  if (config.paramFuzz) {
    all.push(...paramFuzz(targetUrl, wordlist.PARAMS.slice(0, 20))); // 20 params to keep it fast
  }

  // Phase 4: Header fuzz
  if (config.headerFuzz) {
    all.push(...headerFuzz(targetUrl));
  }

  // Get baseline response
  let baseline = null;
  try {
    const b = await _fetch(`${targetUrl.replace(/\/$/, '')}/hecate-baseline-404-${randomUUID()}`, config);
    baseline = { status: b.status, bodyLength: b.body?.length ?? 0 };
  } catch { /* ignore */ }

  // Worker pool
  const queue  = [...all];
  const workers = Array.from({ length: config.concurrency }, () =>
    _worker(scanId, queue, cancel, config, baseline, engagementId)
  );

  await Promise.all(workers);

  if (activeScans.has(scanId)) {
    webappStore.finishScan(scanId);
    activeScans.delete(scanId);
  }
}

async function _worker(scanId, queue, cancel, config, baseline, engagementId) {
  while (!cancel.cancelled && queue.length > 0) {
    const req = queue.shift();
    if (!req) break;

    let res;
    try {
      res = await _fetch(req.url, config, req.headers ?? {});
    } catch (err) {
      webappStore.saveRequest({ scanId, req, status: null, error: err.message });
      continue;
    }

    // Run checks
    const findings = checks.runAll(
      { url: req.url, method: req.method, headers: req.headers ?? {} },
      res,
      config.checkList
    );

    // Flag fuzzer hits
    if (isHit(req, res, baseline)) {
      webappStore.saveRequest({ scanId, req, status: res.status, bytes: res.bytes,
                                isFuzzHit: true, findings });
      for (const f of findings) {
        webappStore.saveFinding({ scanId, engagementId, url: req.url, ...f });
      }
    } else if (findings.length) {
      webappStore.saveRequest({ scanId, req, status: res.status, isFuzzHit: false, findings });
      for (const f of findings) {
        webappStore.saveFinding({ scanId, engagementId, url: req.url, ...f });
      }
    }

    // Rate limit
    await _sleep(1000 / config.ratePerSec);
    await new Promise(r => setImmediate(r));
  }
}

async function _fetch(url, config, extraHeaders = {}) {
  const headers = {
    'User-Agent': config.userAgent,
    ...extraHeaders,
  };
  const allowPrivate = config.allowPrivateTargets ?? false;
  const maxRedirects = config.maxRedirects ?? 5;

  await ssrfGuard.validateUrl(url, { allowPrivate });

  let currentUrl = url;
  let redirects = 0;

  while (true) {
    const res = await fetch(currentUrl, {
      method:  'GET',
      headers,
      redirect: 'manual',
      signal:  AbortSignal.timeout(config.timeoutMs),
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location') && config.followRedirects) {
      if (redirects >= maxRedirects) throw new Error('Maximum redirect count exceeded');
      const nextUrl = new URL(res.headers.get('location'), currentUrl).toString();
      await ssrfGuard.validateUrl(nextUrl, { allowPrivate });
      currentUrl = nextUrl;
      redirects++;
      continue;
    }

    const maxBodyBytes = Math.max(1, Number(config.maxBodyBytes) || 1);
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      try { await res.body?.cancel(); } catch {}
      throw new Error('Response body exceeds configured maximum');
    }

    const reader = res.body?.getReader();
    const chunks = [];
    let totalBytes = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maxBodyBytes) {
            await reader.cancel();
            throw new Error('Response body exceeds configured maximum');
          }
          chunks.push(value);
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }
    }

    const buf = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = new TextDecoder('utf-8', { fatal: false }).decode(buf);

    return {
      ok:      res.ok,
      url:     currentUrl,
      status:  res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      bytes:   totalBytes,
    };
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { start, cancelScan, listActive, DEFAULT_CONFIG };
