'use strict';

/**
 * HECATE Recon — API Routes
 * Mounted at /api/v1/recon by the main router when the recon module is loaded.
 */

const { Router }      = require('express');
const { randomUUID }  = require('crypto');
const crawler         = require('../engine/crawler');
const reconStore      = require('../storage/recon-store');
const { HecateError } = require('../../../api/middleware/error-handler');
const { requireEngagement, requireResource } = require('../../../core/auth/authorization');
const { validateUrl } = require('../target/ssrf-guard');

const router = Router();

// ── Jobs ──────────────────────────────────────────────────────────────────────

// GET /recon/jobs?eid=
router.get('/jobs', (req, res, next) => {
  try {
    const engagementId = req.query.eid ?? null;
    if (engagementId) requireEngagement(req, engagementId);
    const jobs = reconStore.listJobs(engagementId);
    res.json({ jobs, total: jobs.length });
  } catch (err) { next(err); }
});

// POST /recon/jobs — start a new crawl
router.post('/jobs', async (req, res, next) => {
  try {
    const { engagementId, targetId, seedUrls, config } = req.body ?? {};
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    requireEngagement(req, engagementId);
    if (!Array.isArray(seedUrls) || !seedUrls.length) {
      throw new HecateError('HECATE_BAD_INPUT', 'seedUrls[] required');
    }

    // Validate seed URLs
    for (const u of seedUrls) {
      try { await validateUrl(u, { allowPrivate: config?.allowPrivateTargets ?? false }); } catch (err) {
        throw new HecateError('HECATE_BAD_INPUT', err.message);
      }
    }

    const jobId = await crawler.start({ engagementId, targetId, seedUrls, config });
    res.status(202).json({ jobId, status: 'running', seedUrls });
  } catch (err) { next(err); }
});

// GET /recon/jobs/:id
router.get('/jobs/:id', (req, res, next) => {
  try {
    const job = reconStore.getJob(req.params.id);
    requireResource(req, job, 'Recon job');
    if (!job) throw new HecateError('HECATE_NOT_FOUND', 'Job not found');
    res.json({ job: reconStore.deserializeJob?.(job) ?? job });
  } catch (err) { next(err); }
});

// GET /recon/jobs/:id/stats
router.get('/jobs/:id/stats', (req, res, next) => {
  try {
    const job = reconStore.getJob(req.params.id);
    requireResource(req, job, 'Recon job');
    if (!job) throw new HecateError('HECATE_NOT_FOUND', 'Job not found');
    const stats = reconStore.jobStats(req.params.id);
    const active = crawler.list().includes(req.params.id);
    res.json({ jobId: req.params.id, active, ...stats });
  } catch (err) { next(err); }
});

// DELETE /recon/jobs/:id — cancel
router.delete('/jobs/:id', (req, res, next) => {
  try {
    const job = reconStore.getJob(req.params.id);
    requireResource(req, job, 'Recon job');
    const cancelled = crawler.cancel(req.params.id);
    if (!cancelled) throw new HecateError('HECATE_NOT_FOUND', 'Job not found or not running');
    res.json({ ok: true, jobId: req.params.id, status: 'cancelled' });
  } catch (err) { next(err); }
});

// ── Results ───────────────────────────────────────────────────────────────────

// GET /recon/jobs/:id/pages?type=&hasSecrets=&limit=
router.get('/jobs/:id/pages', (req, res, next) => {
  try {
    const job = reconStore.getJob(req.params.id);
    requireResource(req, job, 'Recon job');
    const { type, hasSecrets, limit } = req.query;
    const pages = reconStore.getPagesByJob(req.params.id, {
      type:       type       ?? null,
      hasSecrets: hasSecrets === 'true',
      limit:      limit ? parseInt(limit, 10) : null,
    });
    res.json({ pages, total: pages.length });
  } catch (err) { next(err); }
});

// GET /recon/jobs/:id/secrets
router.get('/jobs/:id/secrets', (req, res, next) => {
  try {
    const job = reconStore.getJob(req.params.id);
    requireResource(req, job, 'Recon job');
    const secrets = reconStore.getSecretsByJob(req.params.id);
    res.json({ secrets, total: secrets.length });
  } catch (err) { next(err); }
});

// GET /recon/jobs/:id/forms
router.get('/jobs/:id/forms', (req, res, next) => {
  try {
    const job = reconStore.getJob(req.params.id);
    requireResource(req, job, 'Recon job');
    const forms = reconStore.getFormsByJob(req.params.id);
    res.json({ forms, total: forms.length });
  } catch (err) { next(err); }
});

// ── Config reference ──────────────────────────────────────────────────────────

// GET /recon/config/defaults
router.get('/config/defaults', (req, res) => {
  res.json({ defaults: crawler.DEFAULT_CONFIG });
});

// GET /recon/profiles
router.get('/profiles', (req, res) => {
  const { PROFILES } = require('../stealth/profiles');
  res.json({ profiles: Object.entries(PROFILES).map(([name, p]) => ({
    name, label: p.label, jitterMs: p.jitterMs
  })) });
});

module.exports = router;
