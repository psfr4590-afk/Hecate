'use strict';

/**
 * HECATE — C2 Module
 * Sliver-inspired command & control framework.
 * Call init(deps) after core DB is ready.
 *
 * Required deps:
 *   deps.db           — node:sqlite Database instance
 *   deps.KeyManager   — core/crypto/key-manager
 *   deps.eventBus     — core/events/event-bus
 *
 * Two endpoints registered:
 *   /api/v1/c2/*    — operator API (authenticated via standard HECATE token)
 *   /c2/beacon      — implant beacon (authenticated via implant AES key)
 */

const c2Store       = require('./storage/c2-store');
const beaconStore   = require('./beacon/beacon-store');
const beaconHandler = require('./beacon/beacon-handler');
const routes        = require('./api/routes');

let _initialised  = false;
let _sweepTimer   = null;

function init(deps = {}) {
  if (_initialised) return;
  const { db, KeyManager, eventBus } = deps;

  if (!db)         throw new Error('C2 module requires deps.db');
  if (!KeyManager) throw new Error('C2 module requires deps.KeyManager');

  c2Store.init(db, KeyManager);

  if (eventBus) {
    beaconStore.setEventBus(eventBus);
    beaconHandler.setEventBus(eventBus);
  }

  // Stale implant sweeper — every 60s
  _sweepTimer = setInterval(() => beaconStore.sweepStale(), 60_000).unref();

  _initialised = true;
}

function shutdown() {
  if (_sweepTimer) { clearInterval(_sweepTimer); _sweepTimer = null; }
}

/**
 * Express middleware for the beacon endpoint.
 * Mount at app.post('/c2/beacon', c2.beaconMiddleware) BEFORE auth middleware
 * (implants don't use the operator token).
 */
async function beaconMiddleware(req, res) {
  const implantId = req.headers['x-agent-id'];
  if (!implantId) return res.status(204).end();

  let rawBody = '';
  req.on('data', c => { rawBody += c; });
  await new Promise(r => req.on('end', r));

  const { status, body } = await beaconHandler.handle({
    implantId,
    rawBody: rawBody.trim(),
    ip:      req.ip ?? req.socket?.remoteAddress,
  });

  res.status(status);
  if (body) res.send(body);
  else res.end();
}

module.exports = {
  init,
  shutdown,
  routes,            // Express Router — mount at /api/v1/c2
  beaconMiddleware,  // mount at POST /c2/beacon (before auth)
};
