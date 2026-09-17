'use strict';

/**
 * HECATE Recon — Result Writer
 * Bridges the recon module to the HECATE core data model.
 * Converts crawl results into Evidence records and Target upserts
 * that operators can see across the full platform.
 *
 * This is the single point of coupling between modules/recon/
 * and core/db/. Keep it thin.
 */

const { randomUUID } = require('crypto');

// Injected at module init
let Evidence = null;
let Target   = null;
let eventBus = null;

function init(deps) {
  Evidence = deps.Evidence;
  Target   = deps.Target;
  eventBus = deps.eventBus;
}

/**
 * Write a crawled page as an Evidence record.
 * Called for pages with noteworthy signals (secrets, interesting type, forms).
 */
function writePageEvidence(engagementId, jobId, page, parsed, tech, semantic, secrets) {
  if (!Evidence) return;

  // Only write evidence for pages that have something worth noting
  const isInteresting =
    secrets.length > 0 ||
    !['generic', 'redirect'].includes(semantic.type) ||
    tech.detections.length > 0;

  if (!isInteresting) return;

  const data = {
    jobId,
    url:       page.url,
    depth:     page.depth,
    status:    page.statusCode,
    title:     parsed.title,
    pageType:  semantic.type,
    pageConf:  semantic.confidence,
    forms:     parsed.forms?.length ?? 0,
    secrets:   secrets.length,
    tech:      tech.summary,
    hasCdn:    tech.hasCdn,
    hasWaf:    tech.hasWaf,
  };

  Evidence.create({
    engagementId,
    type:   `recon:${semantic.type}`,
    module: 'recon',
    label:  `${semantic.type.toUpperCase()} — ${page.url}`,
    data:   JSON.stringify(data),
  });
}

/**
 * Write secret findings as Evidence records.
 * One Evidence record per high-confidence secret finding.
 */
function writeSecretEvidence(engagementId, jobId, pageUrl, secrets) {
  if (!Evidence) return;

  for (const s of secrets) {
    if (s.conf === 'low') continue; // entropy hits are noise — skip unless operator wants them

    Evidence.create({
      engagementId,
      type:   'recon:secret',
      module: 'recon',
      label:  `Secret [${s.type}] — ${pageUrl}`,
      data:   JSON.stringify({
        jobId,
        secretType: s.type,
        conf:       s.conf,
        redacted:   s.redacted,
        length:     s.length,
        entropy:    s.entropy,
        line:       s.line,
        source:     pageUrl,
      }),
    });

    // Emit event for live WS feed
    eventBus?.emit('recon:secret_found', {
      engagementId, jobId,
      secretType: s.type, conf: s.conf,
      redacted:   s.redacted, url: pageUrl,
    });
  }
}

/**
 * Upsert a crawled host/URL as a Target.
 * Called for the seed URL and any discovered hosts outside the seed.
 */
function upsertTarget(engagementId, targetId, url, label, metadata) {
  if (!Target) return null;
  try {
    const parsed = new URL(url);
    return Target.upsert({
      engagementId,
      type:     'url',
      value:    url,
      label:    label ?? parsed.hostname,
      metadata: JSON.stringify(metadata ?? {}),
    });
  } catch {
    return null;
  }
}

/**
 * Emit a standard recon progress event.
 */
function emitProgress(engagementId, jobId, stats) {
  eventBus?.emit('recon:progress', { engagementId, jobId, ...stats });
}

function emitComplete(engagementId, jobId, stats) {
  eventBus?.emit('recon:complete', { engagementId, jobId, ...stats });
}

function emitError(engagementId, jobId, error) {
  eventBus?.emit('recon:error', { engagementId, jobId, error: String(error) });
}

module.exports = {
  init,
  writePageEvidence,
  writeSecretEvidence,
  upsertTarget,
  emitProgress,
  emitComplete,
  emitError,
};
