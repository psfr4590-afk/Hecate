'use strict';

const { Router }      = require('express');
const Engagement      = require('../../core/db/models/engagement');
const { requireEngagement, operatorId } = require('../../core/auth/authorization');
const { HecateError } = require('../middleware/error-handler');

const router = Router();

// GET /engagements — list only engagements visible to this operator
router.get('/', async (req, res, next) => {
  try {
    const rows = Engagement.list(operatorId(req));
    res.json({ engagements: rows, total: rows.length });
  } catch (err) { next(err); }
});

// POST /engagements — create and automatically own the new engagement
router.post('/', async (req, res, next) => {
  try {
    const { name, description, scope, status } = req.body ?? {};
    if (!name) throw new HecateError('HECATE_BAD_INPUT', 'name is required');

    const id = Engagement.create({ name, description, scope, status, ownerOperatorId: operatorId(req) });
    const row = Engagement.findById(id);
    res.status(201).json({ engagement: row });
  } catch (err) { next(err); }
});

// GET /engagements/:id
router.get('/:id', async (req, res, next) => {
  try {
    const row = requireEngagement(req, req.params.id);
    res.json({ engagement: row });
  } catch (err) { next(err); }
});

// PATCH /engagements/:id — partial update
router.patch('/:id', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.id);
    const { name, description, scope, status } = req.body ?? {};
    Engagement.update(req.params.id, { name, description, scope, status });
    res.json({ engagement: Engagement.findById(req.params.id) });
  } catch (err) { next(err); }
});

// DELETE /engagements/:id
router.delete('/:id', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.id);
    Engagement.remove(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
