'use strict';

/**
 * HECATE — Unified API Router
 * Mounts core resource routes + all module routes.
 * Module routes are registered lazily after module init.
 */

const { Router } = require('express');
const rateLimit  = require('./middleware/rate-limit');

// Core routes
const engagements = require('./routes/engagements');
const targets     = require('./routes/targets');
const credentials = require('./routes/credentials');
const sessions    = require('./routes/sessions');
const evidence    = require('./routes/evidence');
const findings    = require('./routes/findings');
const graph       = require('./routes/graph');
const audit       = require('./routes/audit');
const reports     = require('./routes/reports');

const credLimit = rateLimit.create({ windowMs: 60_000, max: 30, message: 'Credential rate limit exceeded.' });

const router = Router();

// ── Core resource routes ──────────────────────────────────────────────────────
router.use('/engagements',  engagements);
router.use('/targets',      targets);
router.use('/credentials',  credLimit, credentials);
router.use('/sessions',     sessions);
router.use('/evidence',     evidence);
router.use('/findings',     findings);
router.use('/graph',        graph);
router.use('/audit',        audit);
router.use('/reports',      reports);

// ── Module routes (mounted after module init in server.js) ────────────────────
// Modules register themselves via router.registerModule()

const moduleRoutes = new Map();

function registerModule(name, moduleRouter) {
  moduleRoutes.set(name, moduleRouter);
  router.use(`/${name}`, moduleRouter);
}

// ── Platform status ───────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const wsServer = req._hecateWsServer;
  res.json({
    platform: 'HECATE',
    version:  require('../package.json').version,
    uptime:   process.uptime(),
    modules:  [...moduleRoutes.keys()],
    clients:  wsServer?.clientCount() ?? 0,
    ts:       new Date().toISOString(),
  });
});

module.exports = router;
module.exports.registerModule = registerModule;
