'use strict';

/**
 * HECATE — CLI: start
 * Full platform startup: DB → Key → Modules → Server
 */

const path        = require('path');
const fs          = require('fs');
const { Command } = require('commander');

const Database   = require('../../core/db/database');
const KeyManager = require('../../core/crypto/key-manager');
const eventBus   = require('../../core/events/event-bus');
const server     = require('../../api/server');

// Core models/stores passed as deps to modules
const Evidence        = require('../../core/db/models/evidence');
const Target          = require('../../core/db/models/target');
const CredentialStore = require('../../core/store/credential-store');
const ADGraph         = require('../../core/graph/ad-graph');

// Modules
const recon      = require('../../modules/recon');
const evilProxy  = require('../../modules/evil-proxy');
const c2         = require('../../modules/c2');
const delivery   = require('../../modules/delivery');
const mitm       = require('../../modules/mitm');
const webapp     = require('../../modules/webapp');
const postExploit = require('../../modules/post-exploit');

const DEFAULT_PORT    = 7331;
const DEFAULT_HOST    = '127.0.0.1';
const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'hecate.db');

function validateRuntimeEnvironment() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Node.js ${process.versions.node} is unsupported. HECATE requires Node.js 22 or newer`);
  }
  if (typeof require('node:sqlite').DatabaseSync !== 'function') {
    throw new Error('node:sqlite is unavailable. Start HECATE with --experimental-sqlite on Node 22/23 environments that require the flag');
  }
}

function validateStartOptions(opts) {
  const port = Number.parseInt(opts.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${opts.port}. Expected an integer from 1 to 65535`);
  }
  if (typeof opts.host !== 'string' || !opts.host.trim()) {
    throw new Error('Host must be a non-empty string');
  }
  const dbPath = path.resolve(opts.db);
  const dbDir = path.dirname(dbPath);
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    fs.accessSync(dbDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    throw new Error(`Database directory is not accessible: ${dbDir} (${err.message})`);
  }
  return { port, host: opts.host.trim(), dbPath };
}

const cmd = new Command('start');

cmd
  .description('Start the HECATE platform')
  .option('-p, --port <port>',   `Port (default: ${DEFAULT_PORT})`,   String(DEFAULT_PORT))
  .option('-H, --host <host>',   `Host (default: ${DEFAULT_HOST})`,   DEFAULT_HOST)
  .option('-d, --db <path>',     'SQLite database path',               DEFAULT_DB_PATH)
  .option('-k, --key <path>',    'AES-256 key file path')
  .option('--dry-run',           'Delivery module: do not send emails')
  .option('--log-level <level>', 'Log level',                          'info')
  .action(async (opts) => {
    let validated;
    try {
      validateRuntimeEnvironment();
      validated = validateStartOptions(opts);
    } catch (err) { fatal(err.message); }
    const { port, host, dbPath } = validated;
    const keyPath = opts.key ?? process.env.HECATE_KEY_PATH;

    if (!keyPath)              fatal('No key path. Set HECATE_KEY_PATH or pass --key <path>');
    if (!fs.existsSync(keyPath)) fatal(`Key file not found: ${keyPath}`);
    if (process.platform !== 'win32') {
      try {
        const mode = fs.statSync(keyPath).mode & 0o777;
        if ((mode & 0o077) !== 0) fatal(`Key file permissions are too broad: ${keyPath} (${mode.toString(8)})`);
      } catch (err) { fatal(`Key file permission check failed: ${err.message}`); }
    }

    // ── Database ──────────────────────────────────────────────────────────────
    log('info', 'Initialising database', { db: dbPath });
    let db;
    try { db = Database.init({ path: dbPath }); }
    catch (err) { fatal(`Database init failed: ${err.message}`); }

    // ── Encryption key ────────────────────────────────────────────────────────
    log('info', 'Loading encryption key');
    try { await KeyManager.load(keyPath); }
    catch (err) { fatal(`Key load failed: ${err.message}`); }

    const coreDeps = { db, KeyManager, eventBus, Evidence, Target, ADGraph };

    // ── Module initialisation (order matters — core deps first) ───────────────
    log('info', 'Initialising modules');

    function initModule(name, initFn, routes) {
      try {
        initFn();
        server.registerModule(name, routes);
      } catch (err) {
        fatal(`${name} module init failed: ${err.message}`);
      }
    }

    initModule('recon', () => recon.init({ ...coreDeps }), recon.routes);
    initModule('evil-proxy', () => evilProxy.init({ ...coreDeps, phishletDir: process.env.HECATE_PHISHLET_DIR }), evilProxy.routes);

    let c2BeaconMiddleware = null;
    initModule('c2', () => {
      c2.init(coreDeps);
      c2BeaconMiddleware = c2.beaconMiddleware;
    }, c2.routes);

    initModule('delivery', () => delivery.init({ db, eventBus, dryRun: opts.dryRun ?? false }), delivery.routes);
    server.registerPublicRoute('/api/v1/delivery/track', delivery.trackingRoutes);
    initModule('mitm', () => mitm.init({ db, eventBus }), mitm.routes);
    initModule('webapp', () => webapp.init({ db, eventBus }), webapp.routes);
    initModule('post-exploit', () => postExploit.init({ db, eventBus, ADGraph, taskQueue: require('../../modules/c2/implant/task-queue') }), postExploit.routes);

    // ── Start server ──────────────────────────────────────────────────────────
    log('info', 'Starting HECATE server', { host, port });
    try {
      await server.start({ port, host, c2BeaconMiddleware });
    } catch (err) { fatal(`Server start failed: ${err.message}`); }

    log('info', `HECATE ready — http://${host}:${port}`);
    log('info', `API base — http://${host}:${port}/api/v1/`);

    // ── Signal handling ───────────────────────────────────────────────────────
    let shuttingDown = false;
    async function shutdown(sig) {
      if (shuttingDown) return;
      shuttingDown = true;
      log('info', `${sig} — shutting down`);
      try {
        // Stop producers/workers before closing the transports or database.
        await Promise.all([
          Promise.resolve(recon.shutdown?.()),
          Promise.resolve(webapp.shutdown?.()),
          Promise.resolve(delivery.shutdown?.()),
          Promise.resolve(c2.shutdown?.()),
          Promise.resolve(evilProxy.shutdown?.()),
          Promise.resolve(mitm.shutdown?.()),
          Promise.resolve(postExploit.shutdown?.()),
        ]);
        await server.stop();
        KeyManager.clear();
        Database.close();
      } catch (err) { process.stderr.write(`Shutdown error: ${err.message}\n`); }
      process.exit(0);
    }

    process.once('SIGINT',  () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException',  err => process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), event: 'uncaught', message: err.message, stack: err.stack }) + '\n'));
    process.on('unhandledRejection', reason => process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), event: 'unhandledRejection', message: String(reason) }) + '\n'));
  });

function log(level, message, meta = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta }) + '\n');
}
function fatal(message) {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', message }) + '\n');
  process.exit(1);
}

module.exports = cmd;
module.exports.validateStartOptions = validateStartOptions;
