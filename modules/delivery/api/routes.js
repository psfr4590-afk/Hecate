'use strict';

const { Router }         = require('express');
const campaignManager    = require('../campaign/campaign-manager');
const targetStore        = require('../target/target-store');
const { parseCSV, dedup } = require('../target/list-parser');
const { validate }       = require('../template/validator');
const mailer             = require('../send/mailer');
const tracker            = require('../tracking/tracker');
const { HecateError }    = require('../../../api/middleware/error-handler');
const { requireEngagement, requireResource } = require('../../../core/auth/authorization');

const router = Router();

// ── Campaigns ─────────────────────────────────────────────────────────────────

router.get('/campaigns', (req, res, next) => {
  try {
    const engagementId = req.query.eid;
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'eid required');
    requireEngagement(req, engagementId);
    const all = campaignManager.list(engagementId);
    res.json({ campaigns: all.map(safeCampaign), total: all.length });
  } catch (err) { next(err); }
});

router.post('/campaigns', (req, res, next) => {
  try {
    const { engagementId, name, template, trackingBase,
            sendsPerHour, fromName, fromEmail, smtpProfileId } = req.body ?? {};
    if (!engagementId)  throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    if (!name)          throw new HecateError('HECATE_BAD_INPUT', 'name required');
    if (!trackingBase)  throw new HecateError('HECATE_BAD_INPUT', 'trackingBase required');
    requireEngagement(req, engagementId);

    if (template) {
      const v = validate(template);
      if (!v.valid) throw new HecateError('HECATE_BAD_INPUT', v.errors.join('; '));
    }

    const camp = campaignManager.create({
      engagementId, name, template, trackingBase,
      sendsPerHour, fromName, fromEmail, smtpProfileId,
    });
    res.status(201).json({ campaign: safeCampaign(camp) });
  } catch (err) { next(err); }
});

router.get('/campaigns/:id', (req, res, next) => {
  try {
    const c = campaignManager.get(req.params.id);
    requireResource(req, c, 'Campaign');
    if (!c) throw new HecateError('HECATE_NOT_FOUND', 'Campaign not found');
    res.json({ campaign: safeCampaign(c) });
  } catch (err) { next(err); }
});

router.get('/campaigns/:id/stats', (req, res, next) => {
  try {
    const c = campaignManager.get(req.params.id);
    requireResource(req, c, 'Campaign');
    if (!c) throw new HecateError('HECATE_NOT_FOUND', 'Campaign not found');
    res.json(campaignManager.stats(req.params.id));
  } catch (err) { next(err); }
});

// POST /campaigns/:id/targets — add targets (raw array or CSV string)
router.post('/campaigns/:id/targets', (req, res, next) => {
  try {
    const { targets: raw, csv } = req.body ?? {};
    let targets;

    if (csv) {
      const parsed = parseCSV(csv);
      targets = dedup(parsed.targets);
    } else if (Array.isArray(raw)) {
      targets = raw;
    } else {
      throw new HecateError('HECATE_BAD_INPUT', 'targets[] or csv string required');
    }

    requireResource(req, campaignManager.get(req.params.id), 'Campaign');
    const result = campaignManager.addTargets(req.params.id, targets);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/campaigns/:id/targets', (req, res, next) => {
  try {
    const camp = campaignManager.get(req.params.id);
    requireResource(req, camp, 'Campaign');
    const targets = targetStore.listByCampaign(req.params.id, req.query.state ?? null);
    res.json({ targets, total: targets.length });
  } catch (err) { next(err); }
});

// POST /campaigns/:id/state — transition state
router.post('/campaigns/:id/state', (req, res, next) => {
  try {
    const { state } = req.body ?? {};
    if (!state) throw new HecateError('HECATE_BAD_INPUT', 'state required');
    requireResource(req, campaignManager.get(req.params.id), 'Campaign');
    const camp = campaignManager.transition(req.params.id, state);
    res.json({ campaign: safeCampaign(camp) });
  } catch (err) {
    if (err.message?.includes('Cannot transition')) {
      return next(new HecateError('HECATE_BAD_INPUT', err.message));
    }
    next(err);
  }
});

router.delete('/campaigns/:id', (req, res, next) => {
  try {
    requireResource(req, campaignManager.get(req.params.id), 'Campaign');
    campaignManager.remove(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── SMTP Profiles ─────────────────────────────────────────────────────────────

router.get('/smtp', (req, res, next) => {
  try {
    const engagementId = req.query.eid;
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'eid required');
    requireEngagement(req, engagementId);
    res.json({ profiles: mailer.listProfiles(engagementId) });
  } catch (err) { next(err); }
});

router.post('/smtp', (req, res, next) => {
  try {
    const { engagementId, id, host, port, secure, user, pass, rejectUnauthorized } = req.body ?? {};
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    requireEngagement(req, engagementId);
    if (!id || !host) throw new HecateError('HECATE_BAD_INPUT', 'id and host required');
    mailer.addProfile({ engagementId, id, host, port, secure, user, pass, rejectUnauthorized });
    res.status(201).json({ profile: mailer.getProfile(id, engagementId) });
  } catch (err) { next(err); }
});

router.delete('/smtp/:id', (req, res, next) => {
  try {
    const engagementId = req.query.eid;
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'eid required');
    requireEngagement(req, engagementId);
    if (!mailer.getProfile(req.params.id, engagementId)) throw new HecateError('HECATE_NOT_FOUND', 'SMTP profile not found');
    mailer.removeProfile(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeCampaign(c) {
  const { _targets, template, ...safe } = c;
  return {
    ...safe,
    targetCount:  _targets?.length ?? 0,
    hasTemplate:  !!template,
  };
}

module.exports = router;
