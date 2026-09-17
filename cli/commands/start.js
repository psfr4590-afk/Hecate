'use strict';

/**
 * HECATE — CLI: start
 * Full platform startup: DB → Key → Modules → Server
 */

const path        = require('path');
const os          = require('os');
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
const recon       = require('../../modules/recon');
const evilProxy   = require('../../modules/evil-proxy');
const c2          = require('../../modules/c2');
const delivery    = require('../../modules/delivery');
const mitm        = require('../../modules/mitm');
const webapp      = require('../../modules/webapp');
const postExploit = require('../../modules/post-exploit');

const DEFAULT_PORT    = 7331;
const DEFAULT_HOST    = '127.0.0.1';
const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'hecate.db');

function expandPath(value) {
  const input = String(value);
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
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
    const port    = Number.parseInt(opts.port, 10);
    const host    = String(opts.host || DEFAULT_HOST).trim();
    const dbPath  = path.resolve(expandPath(opts.db));
    const keyPath = opts.key ?? process.env.HECATE_KEY_PATH;

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fatal(`Invalid port: ${opts.port}. Port must be an integer from 1 to 65535.`);
    }
    if (!host) fatal('Host cannot be empty');
    if (!process.env.HECATE_API_TOKEN) fatal('HECATE_API_TOKEN is required before starting HECATE');
    if (!keyPath) fatal('No key path. Set HECATE_KEY_PATH or pass --key <path>');

    const resolvedKeyPath = path.resolve(expandPath(keyPath));
    if (!fs.existsSync(resolvedKeyPath)) fatal(`Key file not found: ${resolvedKeyPath}`);
    if (!fs.statSync(resolvedKeyPath).isFile()) fatal(`Key path is not a file: ${resolvedKeyPath}`);

    // ── Database ──────────────────────────────────────────────────────────────
    log('info', 'Initialising database', { db: dbPath });
    let db;
    try { db = Database.init({ path: dbPath }); }
    catch (err) { fatal(`Database init failed: ${err.message}`); }

    // ── Encryption key ────────────────────────────────────────────────────────
    log('info', 'Loading encryption key');
    try { await KeyManager.load(resolvedKeyPath); }
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
    initModule('mitm', () => mitm.init({ db, eventBus }), mitm.routes);
    initModule('webapp', () => webapp.init({ db }), webapp.routes);
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
        await server.stop();
        c2.shutdown?.();
        evilProxy.shutdown?.();
        mitm.shutdown?.();
        postExploit.shutdown?.();
        KeyManager.clear();
        Database.close();
      } catch (err) {
        process.stderr.write(`Shutdown error: ${err.message}\n`);
      }
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
