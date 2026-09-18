'use strict';

const { Router }      = require('express');
const net              = require('net');
const mitmStore       = require('../storage/mitm-store');
const dnsSpoofer      = require('../dns/dns-spoofer');
const pipeline        = require('../intercept/pipeline');
const { HecateError } = require('../../../api/middleware/error-handler');
const { requireEngagement, requireResource } = require('../../../core/auth/authorization');

const router = Router();

// ── Sessions ──────────────────────────────────────────────────────────────────

router.get('/sessions', (req, res, next) => {
  try {
    const engagementId = req.query.eid ?? null;
    if (engagementId) requireEngagement(req, engagementId);
    const sessions = mitmStore.listSessions(engagementId);
    res.json({ sessions, total: sessions.length });
  } catch (err) { next(err); }
});

router.post('/sessions', (req, res, next) => {
  try {
    const { engagementId, type, config } = req.body ?? {};
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    requireEngagement(req, engagementId);
    const id = mitmStore.createSession(engagementId, type, config);
    res.status(201).json({ sessionId: id });
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', (req, res, next) => {
  try {
    requireResource(req, mitmStore.getSession(req.params.id), 'MITM session');
    mitmStore.stopSession(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Traffic log ───────────────────────────────────────────────────────────────

router.get('/exchanges', (req, res, next) => {
  try {
    const { session, host, creds, limit, eid } = req.query;
    if (session) requireResource(req, mitmStore.getSession(session), 'MITM session');
    if (!session) {
      if (!eid) throw new HecateError('HECATE_BAD_INPUT', 'eid or session required');
      requireEngagement(req, eid);
    }
    let exchanges = mitmStore.listExchanges({
      sessionId:      session ?? null,
      host:           host    ?? null,
      hasCredentials: creds === 'true',
      engagementId:    eid ?? null,
      limit:          limit ? parseInt(limit, 10) : 100,
    });
    res.json({ exchanges, total: exchanges.length });
  } catch (err) { next(err); }
});

// ── Credentials ───────────────────────────────────────────────────────────────

router.get('/credentials', (req, res, next) => {
  try {
    const sessionId = req.query.session ?? null;
    const eid = req.query.eid ?? null;
    if (sessionId) requireResource(req, mitmStore.getSession(sessionId), 'MITM session');
    if (!sessionId) {
      if (!eid) throw new HecateError('HECATE_BAD_INPUT', 'eid or session required');
      requireEngagement(req, eid);
    }
    let creds = mitmStore.listCredentials(sessionId, eid);
    res.json({ credentials: creds, total: creds.length });
  } catch (err) { next(err); }
});

// ── DNS spoofer ───────────────────────────────────────────────────────────────

router.get('/dns/rules', (req, res, next) => {
  try {
    const sessionId = req.query.session ?? null;
    const eid = req.query.eid ?? null;
    if (sessionId) requireResource(req, mitmStore.getSession(sessionId), 'MITM session');
    if (!sessionId) {
      if (!eid) throw new HecateError('HECATE_BAD_INPUT', 'eid or session required');
      requireEngagement(req, eid);
    }
    let rules = mitmStore.listDnsRules(sessionId, eid);
    res.json({ rules, total: rules.length, active: dnsSpoofer.listEntries() });
  } catch (err) { next(err); }
});

router.post('/dns/rules', (req, res, next) => {
  try {
    const { hostname, spoofIp, sessionId } = req.body ?? {};
    if (!sessionId) throw new HecateError('HECATE_BAD_INPUT', 'sessionId required');
    requireResource(req, mitmStore.getSession(sessionId), 'MITM session');
    if (!hostname || !spoofIp) {
      throw new HecateError('HECATE_BAD_INPUT', 'hostname and spoofIp required');
    }
    // Validate IP
    if (net.isIP(spoofIp) !== 4) {
      throw new HecateError('HECATE_BAD_INPUT', `Invalid IPv4 address: ${spoofIp}`);
    }
    const session = mitmStore.getSession(sessionId);
    dnsSpoofer.setEngagement(session.engagement_id);
    dnsSpoofer.addEntry(hostname, spoofIp);
    mitmStore.saveDnsRule(sessionId, hostname, spoofIp);
    res.status(201).json({ hostname, spoofIp });
  } catch (err) { next(err); }
});

router.delete('/dns/rules/:hostname', (req, res, next) => {
  try {
    const sessionId = req.query.session;
    if (!sessionId) throw new HecateError('HECATE_BAD_INPUT', 'session query parameter required');
    requireResource(req, mitmStore.getSession(sessionId), 'MITM session');
    const session = mitmStore.getSession(sessionId);
    dnsSpoofer.setEngagement(session.engagement_id);
    dnsSpoofer.removeEntry(req.params.hostname);
    mitmStore.removeDnsRule(req.params.hostname, sessionId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /mitm/dns/start — start DNS server
router.post('/dns/start', async (req, res, next) => {
  try {
    const { eid } = req.body ?? {};
    if (!eid) throw new HecateError('HECATE_BAD_INPUT', 'eid required');
    requireEngagement(req, eid);
    if (dnsSpoofer.isRunning()) {
      return res.json({ ok: true, message: 'DNS spoofer already running' });
    }
    const { port, upstream } = req.body ?? {};
    await dnsSpoofer.start({ port, upstream, engagementId: eid });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/dns/stop', async (req, res, next) => {
  try {
    const { eid } = req.body ?? {};
    if (!eid) throw new HecateError('HECATE_BAD_INPUT', 'eid required');
    requireEngagement(req, eid);
    await dnsSpoofer.stop();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Config ────────────────────────────────────────────────────────────────────

router.get('/config', (req, res, next) => {
  try {
    const eid = req.query.eid;
    if (!eid) throw new HecateError('HECATE_BAD_INPUT', 'eid required');
    requireEngagement(req, eid);
    res.json({ stripSsl: true, sniffCredentials: true, logTraffic: true });
  } catch (err) { next(err); }
});

router.patch('/config', (req, res, next) => {
  try {
    const { eid, ...config } = req.body ?? {};
    if (!eid) throw new HecateError('HECATE_BAD_INPUT', 'eid required');
    requireEngagement(req, eid);
    pipeline.setConfig(config);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', (req, res, next) => {
  try {
    const sessionId = req.query.session ?? null;
    const eid = req.query.eid ?? null;
    if (sessionId) requireResource(req, mitmStore.getSession(sessionId), 'MITM session');
    if (!sessionId) {
      if (!eid) throw new HecateError('HECATE_BAD_INPUT', 'eid or session required');
      requireEngagement(req, eid);
    }
    const totals = mitmStore.stats(sessionId, eid);
    res.json({ ...totals, dnsRunning: dnsSpoofer.isRunning() });
  } catch (err) { next(err); }
});

module.exports = router;
