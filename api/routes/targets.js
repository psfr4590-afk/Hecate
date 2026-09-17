'use strict';

const { Router }      = require('express');
const Target          = require('../../core/db/models/target');
const queries         = require('../../core/db/queries/targets');
const { requireEngagement, requireResource, requireTargetInEngagement } = require('../../core/auth/authorization');
const { HecateError } = require('../middleware/error-handler');

const router = Router();

// GET /targets/search?q=&eid=&type=
router.get('/search', async (req, res, next) => {
  try {
    const { q, eid, type } = req.query;
    if (!q && !eid) throw new HecateError('HECATE_BAD_INPUT', 'q or eid required');
    if (eid) requireEngagement(req, eid);
    const rows = eid
      ? queries.search({ q, engagementId: eid, type })
      : queries.searchForOperator({ q, type, operatorId: req.hecateOperatorId || 'local-operator' });
    res.json({ targets: rows, total: rows.length });
  } catch (err) { next(err); }
});

// GET /targets/engagement/:eid — list by authorized engagement
router.get('/engagement/:eid', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const rows = Target.findByEngagement(req.params.eid);
    res.json({ targets: rows, total: rows.length });
  } catch (err) { next(err); }
});

// POST /targets/engagement/:eid
router.post('/engagement/:eid', async (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);
    const { type, value, label, metadata } = req.body ?? {};
    if (!type || !value) throw new HecateError('HECATE_BAD_INPUT', 'type and value are required');

    const id = Target.upsert({ engagementId: eid, type, value, label, metadata });
    res.status(201).json({ target: Target.findByIdForEngagement(id, eid) });
  } catch (err) { next(err); }
});

// GET /targets/:id
router.get('/:id', async (req, res, next) => {
  try {
    const row = Target.findById(req.params.id);
    requireResource(req, row, 'Target');
    res.json({ target: row });
  } catch (err) { next(err); }
});

// PATCH /targets/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const row = Target.findById(req.params.id);
    requireResource(req, row, 'Target');
    Target.updateForEngagement(req.params.id, row.engagement_id, req.body ?? {});
    res.json({ target: Target.findByIdForEngagement(req.params.id, row.engagement_id) });
  } catch (err) { next(err); }
});

// DELETE /targets/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const row = Target.findById(req.params.id);
    requireResource(req, row, 'Target');
    Target.removeForEngagement(req.params.id, row.engagement_id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
