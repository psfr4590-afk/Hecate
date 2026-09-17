'use strict';

/**
 * HECATE Recon — Crawler
 * Orchestrates the full crawl pipeline:
 *   Frontier → Fetcher → Parser → [TechFingerprint + SecretScanner + Semantic]
 *   → ReconStore → ResultWriter → EventBus
 *
 * Concurrency model: fixed async pool (N workers drain the frontier).
 * Each job runs independently; multiple jobs can coexist.
 */

const { randomUUID } = require('crypto');

const Frontier      = require('./frontier');
const Fetcher       = require('./fetcher');
const RateLimiter   = require('../stealth/rate-limiter');
const parser        = require('./parser');
const techFP        = require('../analysis/tech-fingerprint');
const secretScanner = require('../analysis/secret-scanner');
const semantic      = require('../analysis/semantic');
const reconStore    = require('../storage/recon-store');
const resultWriter  = require('../storage/result-writer');

// Active jobs: jobId → { frontier, cancel, config }
const activeJobs = new Map();

const DEFAULT_CONFIG = {
  profile:        'chrome-win',
  concurrency:    3,
  maxDepth:       4,
  maxPages:       1000,
  scope:          'strict',
  ratePerSec:     0.5,
  burst:          3,
  timeoutMs:      15_000,
  maxRetries:     1,
  maxBodyBytes:   5 * 1024 * 1024,
  applyJitter:    true,
  scanSecrets:    true,
  scanInlineJs:   true,
  followRedirects: true,
  allowPrivateTargets: false,
  maxRedirects: 5,
};

/**
 * Start a new crawl job.
 * @param {object} opts
 * @param {string}    opts.engagementId
 * @param {string}    opts.targetId
 * @param {string[]}  opts.seedUrls
 * @param {object}    opts.config      - overrides for DEFAULT_CONFIG
 * @returns {string} jobId
 */
async function start(opts) {
  const { engagementId, targetId, seedUrls } = opts;
  const config = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };

  if (!seedUrls?.length) throw new Error('seedUrls required');

  const { validateUrl } = require('../target/ssrf-guard');
  for (const seed of seedUrls) await validateUrl(seed, { allowPrivate: config.allowPrivateTargets });

  const jobId = randomUUID();
  const seedHost = new URL(seedUrls[0]).hostname;

  // Shared rate limiter across all fetcher workers in this job
  const rateLimiter = new RateLimiter({
    ratePerSec: config.ratePerSec,
    burst:      config.burst,
  });

  const frontier = new Frontier({
    seedHost,
    scope:    config.scope,
    maxDepth: config.maxDepth,
  });
  frontier.seed(seedUrls);

  const cancelToken = { cancelled: false };
  activeJobs.set(jobId, { frontier, cancelToken, config, engagementId });

  // Persist job record
  reconStore.createJob({ id: jobId, engagementId, targetId, seedUrls, config });

  // Upsert seed host as a Target in core
  resultWriter.upsertTarget(engagementId, targetId, seedUrls[0], seedHost, {
    seedUrls, scope: config.scope, jobId
  });

  // Start the crawl asynchronously — don't await
  _runJob(jobId, frontier, cancelToken, config, rateLimiter).catch(err => {
    reconStore.failJob(jobId, err.message);
    resultWriter.emitError(engagementId, jobId, err);
  });

  return jobId;
}

/**
 * Cancel a running job.
 */
function cancel(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return false;
  job.cancelToken.cancelled = true;
  reconStore.cancelJob(jobId);
  activeJobs.delete(jobId);
  return true;
}

function list() {
  return [...activeJobs.keys()];
}

// ── Job runner ────────────────────────────────────────────────────────────────

async function _runJob(jobId, frontier, cancelToken, config, rateLimiter) {
  const { engagementId } = activeJobs.get(jobId) ?? {};
  reconStore.startJob(jobId);
  resultWriter.emitProgress(engagementId, jobId, { status: 'running', queued: frontier.size });

  let pageCount  = 0;
  let errorCount = 0;

  const fetcher = new Fetcher({
    profile:      config.profile,
    timeoutMs:    config.timeoutMs,
    maxRetries:   config.maxRetries,
    maxBodyBytes: config.maxBodyBytes,
    applyJitter:  config.applyJitter,
    rateLimiter,
    allowPrivateTargets: config.allowPrivateTargets,
    maxRedirects: config.maxRedirects,
    followRedirects: config.followRedirects,
  });

  // Worker pool — N concurrent crawlers
  const workers = Array.from({ length: config.concurrency }, () =>
    _worker(jobId, frontier, cancelToken, config, fetcher, engagementId, {
      getPageCount:  () => pageCount,
      incPageCount:  ()  => { pageCount++; },
      incErrorCount: ()  => { errorCount++; },
      maxPages:      config.maxPages,
    })
  );

  await Promise.all(workers);

  if (activeJobs.has(jobId)) {
    reconStore.finishJob(jobId);
    activeJobs.delete(jobId);
    const stats = reconStore.jobStats(jobId);
    resultWriter.emitComplete(engagementId, jobId, { ...stats, errorCount });
  }
}

async function _worker(jobId, frontier, cancelToken, config, fetcher, engagementId, counters) {
  while (!cancelToken.cancelled && !frontier.isEmpty()) {
    if (counters.getPageCount() >= counters.maxPages) break;

    const entry = frontier.pop();
    if (!entry) break;

    counters.incPageCount();

    await _processUrl(jobId, entry, frontier, cancelToken, config, fetcher, engagementId, counters);

    // Emit progress every 10 pages
    if (counters.getPageCount() % 10 === 0) {
      resultWriter.emitProgress(engagementId, jobId, {
        status:  'running',
        pages:   counters.getPageCount(),
        queued:  frontier.size,
        visited: frontier.visited,
      });
    }

    // Brief yield so other workers get CPU
    await new Promise(r => setImmediate(r));
  }
}

async function _processUrl(jobId, entry, frontier, cancelToken, config, fetcher, engagementId) {
  const { url, depth, parentUrl } = entry;
  const pageId = randomUUID();

  let result;
  try {
    result = await fetcher.fetch(url);
  } catch (err) {
    reconStore.savePage({ id: pageId, jobId, url, depth, parentUrl, error: err.message });
    return;
  }

  if (cancelToken.cancelled) return;

  const ct = result.headers['content-type'] ?? '';
  const isHtml = /text\/html/i.test(ct);

  // Parse HTML responses
  const parsed  = isHtml ? parser.parse(result.body ?? '', url) : parser.parse('', url);
  const tech    = techFP.fingerprint(result, parsed);
  const sem     = semantic.classify({
    url, body: result.body ?? '',
    title:   parsed.title ?? '',
    meta:    parsed.meta  ?? {},
    headers: result.headers,
    status:  result.status,
  });

  // Scan for secrets in body + inline scripts
  const secrets = [];
  if (config.scanSecrets) {
    secrets.push(...secretScanner.scan(result.body ?? '', url));
    if (config.scanInlineJs) {
      for (const script of parsed.inlineScripts ?? []) {
        secrets.push(...secretScanner.scan(script, url + '#inline'));
      }
    }
  }

  // Persist page record
  reconStore.savePage({
    id:          pageId,
    jobId,
    url,
    depth,
    parentUrl,
    statusCode:  result.status,
    contentType: ct,
    title:       parsed.title,
    pageType:    sem.type,
    pageConf:    sem.confidence,
    techSummary: tech.summary,
    bytes:       result.bytes,
    linkCount:   parsed.linkCount,
    formCount:   parsed.formCount,
    hasSecrets:  secrets.length > 0,
    error:       result.error,
  });

  // Persist secrets and forms
  if (secrets.length) reconStore.saveSecrets(jobId, pageId, secrets);
  if (parsed.forms?.length) reconStore.saveForms(jobId, pageId, parsed.forms);

  // Write to HECATE core (Evidence + Events)
  resultWriter.writePageEvidence(engagementId, jobId, { url, depth, statusCode: result.status }, parsed, tech, sem, secrets);
  if (secrets.length) resultWriter.writeSecretEvidence(engagementId, jobId, url, secrets);

  // Emit per-page event for live UI feed
  resultWriter.emitProgress(engagementId, jobId, {
    event:    'page_crawled',
    url,
    depth,
    type:     sem.type,
    status:   result.status,
    secrets:  secrets.length,
    tech:     tech.summary,
  });

  // Enqueue discovered links (HTML only)
  if (isHtml && result.ok) {
    for (const link of parsed.links) {
      frontier.push(link, depth + 1, url);
    }
    for (const scriptUrl of parsed.scriptUrls) {
      frontier.push(scriptUrl, depth + 1, url);
    }
  }
}

module.exports = { start, cancel, list, DEFAULT_CONFIG };
