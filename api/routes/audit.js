'use strict';

const { Router }      = require('express');
const AuditLog        = require('../../core/audit/audit-log');
const { HecateError } = require('../middleware/error-handler');
const { requireEngagement } = require('../../core/auth/authorization');

const router = Router();

// GET /audit?limit=50 — tail most recent entries
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 500);
    const engagementId = req.query.engagementId;
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    requireEngagement(req, engagementId);
    const rows  = AuditLog.tail(limit, engagementId);
    res.json({ entries: rows, total: rows.length });
  } catch (err) { next(err); }
});

// GET /audit/range?from=ISO&to=ISO
router.get('/range', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from) throw new HecateError('HECATE_BAD_INPUT', 'from timestamp required');
    const engagementId = req.query.engagementId;
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    requireEngagement(req, engagementId);
    const rows = AuditLog.range(from, to ?? new Date().toISOString(), engagementId);
    res.json({ entries: rows, total: rows.length });
  } catch (err) { next(err); }
});

// GET /audit/verify — verify hash chain integrity
router.get('/verify', async (req, res, next) => {
  try {
    const result = AuditLog.verify();
    const status = result.valid ? 200 : 409;
    res.status(status).json(result);
  } catch (err) { next(err); }
});

module.exports = router;
