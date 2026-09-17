'use strict';

/**
 * HECATE Delivery — Tracker
 * Processes tracking beacon requests from the phishing server.
 *
 * Three event types:
 *   open   — 1x1 pixel request (GET /__t/open/:trackingId)
 *   click  — link redirect (GET /__t/click/:trackingId/:linkId?u=<url>)
 *   submit — form submit (POST /__t/submit/:trackingId)
 *
 * Each event: updates target state, stores event record, emits bus event.
 * Returns HTTP response instructions { status, redirect, body }.
 */

const targetStore = require('../target/target-store');

let _eventBus = null;
function setEventBus(b) { _eventBus = b; }

// 1×1 transparent GIF
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'
);

/**
 * Handle an open-tracking pixel request.
 * @param {string} trackingId
 * @param {object} meta         — { ip, ua }
 * @returns {{ status: 200, body: Buffer, contentType: string }}
 */
function handleOpen(trackingId, meta = {}) {
  const record = targetStore.getByTracking(trackingId);

  if (record) {
    const event = targetStore.recordEvent(trackingId, 'open', meta);
    _emit('delivery:open', {
      trackingId,
      campaignId: record.campaignId,
      email:      record.email,
      ...meta,
    });
  }

  return {
    status:      200,
    body:        PIXEL_GIF,
    contentType: 'image/gif',
    headers:     {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma':        'no-cache',
    },
  };
}

/**
 * Handle a click-tracking redirect request.
 * @param {string} trackingId
 * @param {string} linkId       — sequential link index from renderer
 * @param {string} destUrl      — decoded destination URL
 * @param {object} meta         — { ip, ua }
 * @returns {{ status: 302, redirect: string }}
 */
function handleClick(trackingId, linkId, destUrl, meta = {}) {
  const record = targetStore.getByTracking(trackingId);

  if (record) {
    targetStore.recordEvent(trackingId, 'click', { ...meta, url: destUrl });
    _emit('delivery:click', {
      trackingId,
      campaignId: record.campaignId,
      email:      record.email,
      linkId,
      url:        destUrl,
      ...meta,
    });
  }

  // Redirect to actual destination
  const safe = _validateRedirect(destUrl);
  return { status: 302, redirect: safe };
}

/**
 * Handle a form-submit event (JS beacon POST).
 * @param {string} trackingId
 * @param {object} formData      — { fields: { name: value, ... } }
 * @param {object} meta          — { ip, ua }
 */
function handleSubmit(trackingId, formData = {}, meta = {}) {
  const record = targetStore.getByTracking(trackingId);

  if (record) {
    targetStore.recordEvent(trackingId, 'submit', {
      ...meta,
      data: _redactFormData(formData),
    });
    _emit('delivery:submit', {
      trackingId,
      campaignId:  record.campaignId,
      email:       record.email,
      fieldCount:  Object.keys(formData.fields ?? {}).length,
      ...meta,
    });
  }

  return { status: 200, body: JSON.stringify({ ok: true }), contentType: 'application/json' };
}

/**
 * Validate and sanitise a redirect URL.
 * Prevents open redirect to javascript: or data: URLs.
 */
function _validateRedirect(url) {
  if (!url) return '/';
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return '/';
    return url;
  } catch {
    return '/';
  }
}

/**
 * Redact password-like field values in captured form data.
 * We capture field names but mask likely password values.
 */
function _redactFormData(data) {
  const fields  = data.fields ?? {};
  const out     = {};
  const passPat = /pass|pwd|secret|credential|pin/i;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = passPat.test(k) ? `[${String(v).length} chars]` : v;
  }
  return { fields: out };
}

function _emit(event, data) {
  _eventBus?.emit(event, { ...data, ts: new Date().toISOString() });
}

module.exports = { setEventBus, handleOpen, handleClick, handleSubmit, PIXEL_GIF };
