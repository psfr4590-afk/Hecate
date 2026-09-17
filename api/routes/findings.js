'use strict';

const { Router }      = require('express');
const Finding         = require('../../core/db/models/finding');
const { requireEngagement, requireResource, requireTargetInEngagement } = require('../../core/auth/authorization');
const { HecateError } = require('../middleware/error-handler');

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const router = Router();

router.get('/engagement/:eid', async (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);
    let rows = Finding.findByEngagement(eid);
    const { severity } = req.query;
    if (severity) rows = rows.filter(r => r.severity === severity);
    res.json({ findings: rows, total: rows.length });
  } catch (err) { next(err); }
});

router.post('/engagement/:eid', async (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);
    const { title, severity, module: mod, targetId, description, recommendation, cvss } = req.body ?? {};
    if (!title || !severity) throw new HecateError('HECATE_BAD_INPUT', 'title and severity are required');
    if (!SEVERITIES.has(severity)) throw new HecateError('HECATE_BAD_INPUT', `severity must be one of: ${[...SEVERITIES].join(', ')}`);
    requireTargetInEngagement(req, targetId, eid);
    const id = Finding.create({ engagementId: eid, title, severity, module: mod, targetId, description, recommendation, cvss });
    res.status(201).json({ finding: Finding.findByIdForEngagement(id, eid) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = Finding.findById(req.params.id);
    requireResource(req, row, 'Finding');
    res.json({ finding: row });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = Finding.findById(req.params.id);
    requireResource(req, row, 'Finding');
    Finding.removeForEngagement(req.params.id, row.engagement_id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
