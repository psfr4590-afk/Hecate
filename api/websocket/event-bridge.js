'use strict';

/**
 * HECATE — Event Bridge
 * Projects internal events to WebSocket clients and durable audit records.
 * Runtime event payloads are intentionally sanitised before entering the audit log.
 */

const eventBus = require('../../core/events/event-bus');
const wsServer = require('./ws-server');
const AuditLog = require('../../core/audit/audit-log');

const NAMESPACES = [
  'recon', 'mitm', 'evil-proxy', 'wireless', 'c2', 'delivery',
  'post-exploit', 'pivot', 'webapp', 'core', 'session', 'credential',
];

const handlers = new Map();
const SENSITIVE = /pass(word)?|secret|token|key|credential|cookie|authorization|content|body|data/i;
const MAX_STRING = 512;

function start() {
  for (const ns of NAMESPACES) handlers.set(ns, true);
  if (eventBus._hecateBridgeInstalled) return;

  const originalEmit = eventBus.emit.bind(eventBus);
  eventBus._hecateBridgeOriginalEmit = originalEmit;
  eventBus._hecateBridgeInstalled = true;

  eventBus.emit = function bridgedEmit(event, ...args) {
    const ns = typeof event === 'string' ? event.split(':')[0] : '';
    if (NAMESPACES.includes(ns)) {
      const data = args.length === 1 ? args[0] : args;
      wsServer.broadcast(event, data);
      _audit(event, data);
    }
    return originalEmit(event, ...args);
  };
}

function _audit(event, data) {
  try {
    const clean = _sanitize(data);
    const engagementId = clean?.engagementId ?? clean?.engagement_id ?? null;
    const subject = clean?.id ?? clean?.campaignId ?? clean?.targetId ??
      clean?.implantId ?? clean?.sessionId ?? null;
    AuditLog.append(event, subject, JSON.stringify(clean), engagementId);
  } catch (err) {
    process.stderr.write(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'audit:append_failed',
      message: err.message,
      sourceEvent: event,
    }) + '\n');
  }
}

function _sanitize(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => _sanitize(v, depth + 1));
  if (typeof value !== 'object') return String(value);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE.test(key)) continue;
    out[key] = _sanitize(val, depth + 1);
  }
  return out;
}

function stop() {
  if (!eventBus._hecateBridgeInstalled) return;
  const original = eventBus._hecateBridgeOriginalEmit;
  if (original) eventBus.emit = original;
  delete eventBus._hecateBridgeOriginalEmit;
  eventBus._hecateBridgeInstalled = false;
}

module.exports = { start, stop };
