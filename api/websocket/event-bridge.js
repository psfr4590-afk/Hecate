'use strict';

/**
 * HECATE — Event Bridge
 * Subscribes to the internal event-bus and forwards events
 * to WebSocket clients. This is the only place event-bus
 * and ws-server are coupled — keeps both modules clean.
 *
 * Event naming convention:
 *   Bus event:  recon:target_found
 *   WS frame:   { type: 'recon:target_found', data: {...}, ts: ISO }
 */

const eventBus = require('../../core/events/event-bus');
const wsServer = require('./ws-server');

// All namespaces HECATE emits on. Add here when new modules are implemented.
const NAMESPACES = [
  'recon',
  'mitm',
  'evil-proxy',
  'wireless',
  'c2',
  'delivery',
  'post-exploit',
  'pivot',
  'webapp',
  'core',
  'session',
  'credential',
];

// Wildcard per-namespace — forward everything
const handlers = new Map();

function start() {
  for (const ns of NAMESPACES) {
    const pattern = `${ns}:*`;

    // EventEmitter doesn't support wildcards natively —
    // we subscribe to the specific events we know, plus a catch-all
    // on the bus itself by overriding emit at the bus level (non-destructive).
    // Simpler: eventBus is our own singleton — wrap emit once.
    handlers.set(ns, true);
  }

  // Wrap eventBus.emit to intercept all events and forward to WS
  // Only patch once — guard with a flag on the emitter object itself.
  if (eventBus._hecateBridgeInstalled) return;

  const _origEmit = eventBus.emit.bind(eventBus);
  eventBus._hecateBridgeOriginalEmit = _origEmit;
  eventBus._hecateBridgeInstalled = true;
  eventBus.emit = function bridgedEmit(event, ...args) {
    // Forward to WS if this is a HECATE namespace event
    const ns = event.split(':')[0];
    if (NAMESPACES.includes(ns)) {
      const data = args.length === 1 ? args[0] : args;
      wsServer.broadcast(event, data);
    }
    // Always call original
    return _origEmit(event, ...args);
  };
}

function stop() {
  if (!eventBus._hecateBridgeInstalled) return;
  const originalEmit = eventBus._hecateBridgeOriginalEmit;
  if (originalEmit) eventBus.emit = originalEmit;
  delete eventBus._hecateBridgeOriginalEmit;
  eventBus._hecateBridgeInstalled = false;
}

module.exports = { start, stop };
