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
    const { session, host, creds, limit } = req.query;
    if (session) requireResource(req, mitmStore.getSession(session), 'MITM session');
    const exchanges = mitmStore.listExchanges({
      sessionId:      session ?? null,
      host:           host    ?? null,
      hasCredentials: creds === 'true',
      limit:          limit ? parseInt(limit, 10) : 100,
    });
    res.json({ exchanges, total: exchanges.length });
  } catch (err) { next(err); }
});

// ── Credentials ───────────────────────────────────────────────────────────────

router.get('/credentials', (req, res, next) => {
  try {
    const sessionId = req.query.session ?? null;
    if (sessionId) requireResource(req, mitmStore.getSession(sessionId), 'MITM session');
    const creds = mitmStore.listCredentials(sessionId);
    res.json({ credentials: creds, total: creds.length });
  } catch (err) { next(err); }
});

// ── DNS spoofer ───────────────────────────────────────────────────────────────

router.get('/dns/rules', (req, res, next) => {
  try {
    const sessionId = req.query.session ?? null;
    if (sessionId) requireResource(req, mitmStore.getSession(sessionId), 'MITM session');
    const rules = mitmStore.listDnsRules(sessionId);
    res.json({ rules, total: rules.length, active: dnsSpoofer.listEntries() });
  } catch (err) { next(err); }
});

router.post('/dns/rules', (req, res, next) => {
  try {
    const { hostname, spoofIp, sessionId } = req.body ?? {};
    if (sessionId) requireResource(req, mitmStore.getSession(sessionId), 'MITM session');
    if (!hostname || !spoofIp) {
      throw new HecateError('HECATE_BAD_INPUT', 'hostname and spoofIp required');
    }
    // Validate IP
    if (net.isIP(spoofIp) !== 4) {
      throw new HecateError('HECATE_BAD_INPUT', `Invalid IPv4 address: ${spoofIp}`);
    }
    dnsSpoofer.addEntry(hostname, spoofIp);
    mitmStore.saveDnsRule(sessionId ?? null, hostname, spoofIp);
    res.status(201).json({ hostname, spoofIp });
  } catch (err) { next(err); }
});

router.delete('/dns/rules/:hostname', (req, res, next) => {
  try {
    dnsSpoofer.removeEntry(req.params.hostname);
    mitmStore.removeDnsRule(req.params.hostname);
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /mitm/dns/start — start DNS server
router.post('/dns/start', async (req, res, next) => {
  try {
    if (dnsSpoofer.isRunning()) {
      return res.json({ ok: true, message: 'DNS spoofer already running' });
    }
    const { port, upstream } = req.body ?? {};
    await dnsSpoofer.start({ port, upstream });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/dns/stop', async (req, res, next) => {
  try {
    await dnsSpoofer.stop();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Config ────────────────────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  res.json({ stripSsl: true, sniffCredentials: true, logTraffic: true });
});

router.patch('/config', (req, res, next) => {
  try {
    pipeline.setConfig(req.body ?? {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', (req, res, next) => {
  try {
    const s = mitmStore.stats(req.query.session ?? null);
    res.json({ ...s, dnsRunning: dnsSpoofer.isRunning() });
  } catch (err) { next(err); }
});

module.exports = router;
