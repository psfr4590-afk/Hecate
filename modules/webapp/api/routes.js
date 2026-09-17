'use strict';

// ── API Routes ────────────────────────────────────────────────────────────────

const { Router }      = require('express');
const scanner         = require('../scanner/scanner');
const webappStore     = require('../storage/webapp-store');
const { ALL_CHECKS }  = require('../checks/check-library');
const { HecateError } = require('../../../api/middleware/error-handler');
const { requireEngagement, requireResource, requireTargetInEngagement } = require('../../../core/auth/authorization');
const ssrfGuard = require('../../recon/target/ssrf-guard');

const router = Router();

router.get('/scans', (req, res, next) => {
  try {
    const engagementId = req.query.eid ?? null;
    if (engagementId) requireEngagement(req, engagementId);
    res.json({ scans: webappStore.listScans(engagementId) });
  } catch (err) { next(err); }
});

router.post('/scans', async (req, res, next) => {
  try {
    const { engagementId, targetId, targetUrl, config } = req.body ?? {};
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    requireEngagement(req, engagementId);
    if (targetId) requireTargetInEngagement(req, targetId, engagementId);
    if (!targetUrl)    throw new HecateError('HECATE_BAD_INPUT', 'targetUrl required');
    try {
      await ssrfGuard.validateUrl(targetUrl, { allowPrivate: config?.allowPrivateTargets === true });
    } catch (err) {
      throw new HecateError('HECATE_BAD_INPUT', err.message);
    }
    const scanId = await scanner.start({ engagementId, targetId, targetUrl, config });
    res.status(202).json({ scanId, status: 'running', targetUrl });
  } catch (err) { next(err); }
});

router.get('/scans/:id', (req, res, next) => {
  try {
    const scan = webappStore.getScan(req.params.id);
    requireResource(req, scan, 'Web application scan');
    if (!scan) throw new HecateError('HECATE_NOT_FOUND', 'Scan not found');
    res.json({ scan });
  } catch (err) { next(err); }
});

router.get('/scans/:id/stats', (req, res, next) => {
  try {
    requireResource(req, webappStore.getScan(req.params.id), 'Web application scan');
    const s = webappStore.stats(req.params.id);
    res.json({ scanId: req.params.id, active: scanner.listActive().includes(req.params.id), ...s });
  } catch (err) { next(err); }
});

router.get('/scans/:id/findings', (req, res, next) => {
  try {
    requireResource(req, webappStore.getScan(req.params.id), 'Web application scan');
    const findings = webappStore.getFindings(req.params.id, req.query.severity ?? null);
    res.json({ findings, total: findings.length });
  } catch (err) { next(err); }
});

router.delete('/scans/:id', (req, res, next) => {
  try {
    requireResource(req, webappStore.getScan(req.params.id), 'Web application scan');
    const ok = scanner.cancelScan(req.params.id);
    if (!ok) throw new HecateError('HECATE_NOT_FOUND', 'Scan not found or not running');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/checks', (req, res) => {
  res.json({ checks: ALL_CHECKS.map(c => ({ id: c.id, name: c.name })) });
});

router.get('/config/defaults', (req, res) => {
  res.json({ defaults: scanner.DEFAULT_CONFIG });
});

module.exports = router;
