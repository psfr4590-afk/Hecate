'use strict';

/**
 * HECATE — Recon Module
 * Entry point. Call init(deps) once after core DB is ready.
 * Exports: { init, start, cancel, list, routes }
 *
 * Deps expected:
 *   deps.db        — node:sqlite Database instance (core DB)
 *   deps.Evidence  — core/db/models/evidence
 *   deps.Target    — core/db/models/target
 *   deps.eventBus  — core/events/event-bus
 */

const reconStore   = require('./storage/recon-store');
const resultWriter = require('./storage/result-writer');
const crawler      = require('./engine/crawler');
const routes       = require('./api/routes');

let _initialised = false;

/**
 * Initialise the recon module.
 * Must be called once before any crawl jobs can be started.
 */
function init(deps = {}) {
  if (_initialised) return;

  const { db, Evidence, Target, eventBus } = deps;

  if (!db) throw new Error('Recon module requires a database instance (deps.db)');

  // Initialise the recon SQLite tables
  reconStore.init(db);

  // Wire result writer to core models + event bus
  resultWriter.init({ Evidence, Target, eventBus });

  _initialised = true;
}

module.exports = {
  init,
  start:  crawler.start.bind(crawler),
  cancel: crawler.cancel.bind(crawler),
  list:   crawler.list.bind(crawler),
  shutdown: crawler.shutdown.bind(crawler),
  routes,           // Express Router — mount at /api/v1/recon
  DEFAULT_CONFIG: crawler.DEFAULT_CONFIG,
};
