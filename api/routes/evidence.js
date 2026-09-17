'use strict';

const { Router }      = require('express');
const Evidence        = require('../../core/db/models/evidence');
const { requireEngagement, requireResource, requireTargetInEngagement } = require('../../core/auth/authorization');
const { HecateError } = require('../middleware/error-handler');

const router = Router();

router.get('/engagement/:eid', async (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);
    const { type, module: mod, targetId } = req.query;
    if (targetId) requireTargetInEngagement(req, targetId, eid);
    let rows = targetId ? Evidence.findByTargetForEngagement(targetId, eid) : Evidence.findByEngagement(eid);
    if (type) rows = rows.filter(r => r.type === type);
    if (mod) rows = rows.filter(r => r.module === mod);
    res.json({ evidence: rows, total: rows.length });
  } catch (err) { next(err); }
});

router.post('/engagement/:eid', async (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);
    const { type, module: mod, targetId, label, data, path: filePath } = req.body ?? {};
    if (!type || !mod) throw new HecateError('HECATE_BAD_INPUT', 'type and module are required');
    requireTargetInEngagement(req, targetId, eid);
    const id = Evidence.create({ engagementId: eid, type, module: mod, targetId, label, data, path: filePath });
    res.status(201).json({ evidence: Evidence.findByIdForEngagement(id, eid) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = Evidence.findById(req.params.id);
    requireResource(req, row, 'Evidence');
    res.json({ evidence: row });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = Evidence.findById(req.params.id);
    requireResource(req, row, 'Evidence');
    Evidence.removeForEngagement(req.params.id, row.engagement_id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
