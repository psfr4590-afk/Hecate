'use strict';

const { Router }      = require('express');
const SessionStore    = require('../../core/store/session-store');
const { requireEngagement, requireResource, requireTargetInEngagement, operatorId } = require('../../core/auth/authorization');
const { HecateError } = require('../middleware/error-handler');

const VALID_STATUSES = new Set(['active', 'inactive', 'dead']);
const router = Router();

router.get('/engagement/:eid', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const rows = SessionStore.findByEngagement(req.params.eid);
    res.json({ sessions: rows, total: rows.length });
  } catch (err) { next(err); }
});

router.get('/active', async (req, res, next) => {
  try {
    const rows = SessionStore.listActiveForOperator(operatorId(req));
    res.json({ sessions: rows, total: rows.length });
  } catch (err) { next(err); }
});

router.post('/engagement/:eid', async (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);
    const { module, targetId, transport, metadata } = req.body ?? {};
    if (!module) throw new HecateError('HECATE_BAD_INPUT', 'module is required');
    requireTargetInEngagement(req, targetId, eid);
    const id = SessionStore.create({ engagementId: eid, module, targetId, transport, metadata });
    res.status(201).json({ session: SessionStore.findByIdForEngagement(id, eid) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = SessionStore.findById(req.params.id);
    requireResource(req, row, 'Session');
    res.json({ session: row });
  } catch (err) { next(err); }
});

router.post('/:id/heartbeat', async (req, res, next) => {
  try {
    const row = SessionStore.findById(req.params.id);
    requireResource(req, row, 'Session');
    const ok = SessionStore.heartbeatForEngagement(req.params.id, row.engagement_id);
    if (!ok) throw new HecateError('HECATE_NOT_FOUND', 'Session not found');
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) { next(err); }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body ?? {};
    if (!VALID_STATUSES.has(status)) throw new HecateError('HECATE_BAD_INPUT', `status must be one of: ${[...VALID_STATUSES].join(', ')}`);
    const row = SessionStore.findById(req.params.id);
    requireResource(req, row, 'Session');
    if (status === 'inactive') SessionStore.setInactiveForEngagement(req.params.id, row.engagement_id);
    else if (status === 'dead') SessionStore.setDeadForEngagement(req.params.id, row.engagement_id);
    else throw new HecateError('HECATE_BAD_INPUT', 'Cannot manually set status to active');
    res.json({ session: SessionStore.findByIdForEngagement(req.params.id, row.engagement_id) });
  } catch (err) { next(err); }
});

router.patch('/:id/metadata', async (req, res, next) => {
  try {
    const row = SessionStore.findById(req.params.id);
    requireResource(req, row, 'Session');
    SessionStore.updateMetadataForEngagement(req.params.id, row.engagement_id, req.body ?? {});
    res.json({ session: SessionStore.findByIdForEngagement(req.params.id, row.engagement_id) });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = SessionStore.findById(req.params.id);
    requireResource(req, row, 'Session');
    SessionStore.removeForEngagement(req.params.id, row.engagement_id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
