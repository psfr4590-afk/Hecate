'use strict';

const { Router }        = require('express');
const CredentialStore   = require('../../core/store/credential-store');
const Target            = require('../../core/db/models/target');
const { HecateError }   = require('../middleware/error-handler');
const { requireEngagement, requireResource } = require('../../core/auth/authorization');

const router = Router();

// GET /engagements/:eid/credentials — metadata only (no secrets)
router.get('/engagement/:eid', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const rows = CredentialStore.list(req.params.eid);
    res.json({ credentials: rows, total: rows.length });
  } catch (err) { next(err); }
});

// POST /engagements/:eid/credentials — store + encrypt
router.post('/engagement/:eid', async (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);

    const { type, username, secret, targetId, metadata } = req.body ?? {};
    if (!type || !secret) {
      throw new HecateError('HECATE_BAD_INPUT', 'type and secret are required');
    }
    if (targetId) {
      const target = Target.findByIdForEngagement(targetId, eid);
      if (!target) throw new HecateError('HECATE_NOT_FOUND', 'Target not found in engagement');
    }

    const id = await CredentialStore.store({
      engagementId: eid, type, username, secret, targetId, metadata
    });

    // Return safe view only — never echo the secret back
    const safe = CredentialStore.list(eid).find(c => c.id === id);
    res.status(201).json({ credential: safe });
  } catch (err) { next(err); }
});

// GET /credentials/:id — full retrieve (decrypts)
// Intentionally verbose path to make accidental retrieval harder
router.get('/:id/cleartext', async (req, res, next) => {
  try {
    const safe = CredentialStore.list().find(c => c.id === req.params.id);
    requireResource(req, safe, 'Credential');
    const cred = await CredentialStore.retrieve(req.params.id);
    if (!cred) throw new HecateError('HECATE_NOT_FOUND', 'Credential not found');
    res.json({ credential: cred });
  } catch (err) { next(err); }
});

// GET /credentials/:id — safe view (no secret)
router.get('/:id', async (req, res, next) => {
  try {
    const rows = CredentialStore.list();
    const cred = rows.find(c => c.id === req.params.id);
    requireResource(req, cred, 'Credential');
    res.json({ credential: cred });
  } catch (err) { next(err); }
});

// DELETE /credentials/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const cred = CredentialStore.list().find(c => c.id === req.params.id);
    requireResource(req, cred, 'Credential');
    const removed = CredentialStore.remove(req.params.id);
    if (!removed) throw new HecateError('HECATE_NOT_FOUND', 'Credential not found');
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
