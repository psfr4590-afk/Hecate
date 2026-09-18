'use strict';

/**
 * HECATE — Authenticated WebSocket Server
 * Operator WebSocket clients authenticate with the same API token used by REST.
 * Origin validation remains an additional browser boundary, not an authentication mechanism.
 */

const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Engagement = require('../../core/db/models/engagement');
const wsPolicy = require('./ws-policy');
const auth = require('../middleware/auth');

const PING_INTERVAL_MS = 30_000;
let wss = null;
let pingTimer = null;
const clients = new Map(); // ws -> { id, ip, connectedAt, alive, operatorId }

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function extractToken(req) {
  const authHeader = req?.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim() || null;
  }
  const headerToken = req?.headers?.['x-hecate-token'];
  if (typeof headerToken === 'string') return headerToken.trim() || null;
  return null;
}

function hasBrowserSession(req) {
  return auth.hasLocalSession(req);
}

function nextId() {
  return crypto.randomUUID();
}

function attach(httpServer, opts = {}) {
  if (wss) throw new Error('WebSocket server already attached');
  const allowed = opts.allowedOrigins ?? ['http://127.0.0.1:7331', 'http://localhost:7331'];
  const expectedToken = process.env.HECATE_API_TOKEN ?? '';
  if (!expectedToken) throw new Error('HECATE_API_TOKEN is required for WebSocket authentication');

  wss = new WebSocketServer({ server: httpServer, maxPayload: opts.maxPayload ?? 64 * 1024 });

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin ?? '';
    if (allowed.length && !allowed.includes(origin) && origin !== '') {
      ws.close(1008, 'Origin not allowed');
      return;
    }

    const token = extractToken(req);
    if (!safeEqual(token, expectedToken) && !hasBrowserSession(req)) {
      ws.close(1008, 'Authentication required');
      return;
    }

    const operatorId = process.env.HECATE_OPERATOR_ID || 'local-operator';
    const id = nextId();
    const ip = req.socket.remoteAddress ?? 'unknown';
    clients.set(ws, { id, ip, connectedAt: new Date().toISOString(), alive: true, operatorId });

    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event: 'ws:connect', id, ip }) + '\n');
    _send(ws, { type: 'hecate:connected', id, ts: new Date().toISOString() });

    ws.on('pong', () => { const meta = clients.get(ws); if (meta) meta.alive = true; });
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'ping') _send(ws, { type: 'pong', ts: new Date().toISOString() });
      } catch { /* malformed frames are ignored */ }
    });
    ws.on('close', () => {
      const meta = clients.get(ws);
      process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event: 'ws:disconnect', id: meta?.id, ip }) + '\n');
      clients.delete(ws);
    });
    ws.on('error', err => {
      process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), event: 'ws:error', id, message: err.message }) + '\n');
    });
  });

  pingTimer = setInterval(() => {
    for (const [ws, meta] of clients) {
      if (!meta.alive) { ws.terminate(); clients.delete(ws); continue; }
      meta.alive = false;
      ws.ping();
    }
  }, PING_INTERVAL_MS);
  pingTimer.unref();
  return wss;
}

function broadcast(type, data) {
  if (!wss) return;
  const engagementId = wsPolicy.engagementIdFromData(data);
  if (!wsPolicy.shouldBroadcast(type, data)) return;
  const frame = JSON.stringify({ type, data, ts: new Date().toISOString() });
  for (const [ws, meta] of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (engagementId && !Engagement.isOperatorMember(engagementId, meta.operatorId)) continue;
    ws.send(frame);
  }
}

function _send(ws, payload) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload)); }
function clientCount() { return clients.size; }

function close() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  const server = wss;
  if (!server) {
    clients.clear();
    return Promise.resolve();
  }

  wss = null;

  for (const ws of clients.keys()) {
    try { ws.terminate(); } catch {}
  }
  clients.clear();

  return new Promise(resolve => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

module.exports = { attach, broadcast, clientCount, close, extractToken };
