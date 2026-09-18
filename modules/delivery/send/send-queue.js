'use strict';

/** Durable per-campaign send queue. Timers remain in memory, but queued work,
 * pause state, counters, and in-flight recovery state live in SQLite. */
let db = null;
const timers = new Map();
let _mailer = null;
let _eventBus = null;

function init(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_queue_state (
      campaign_id TEXT PRIMARY KEY,
      sends_per_hour REAL NOT NULL DEFAULT 60,
      paused INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS delivery_send_queue (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      tracking_id TEXT,
      job_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      claimed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_queue_campaign ON delivery_send_queue(campaign_id, status, created_at);
  `);
  // A crash can leave an item marked processing. Make it claimable again.
  db.prepare(`UPDATE delivery_send_queue SET status='queued', claimed_at=NULL WHERE status='processing'`).run();
}
function setMailer(m) { _mailer = m; }
function setEventBus(b) { _eventBus = b; }
function _state(campaignId, sendsPerHour=60) {
  db.prepare(`INSERT OR IGNORE INTO delivery_queue_state(campaign_id,sends_per_hour) VALUES(?,?)`).run(campaignId, sendsPerHour);
  return db.prepare(`SELECT * FROM delivery_queue_state WHERE campaign_id=?`).get(campaignId);
}
function enqueue(job) {
  const { randomUUID } = require('crypto');
  _state(job.campaignId, job.sendsPerHour);
  db.prepare(`INSERT INTO delivery_send_queue(id,campaign_id,tracking_id,job_json) VALUES(?,?,?,?)`)
    .run(randomUUID(), job.campaignId, job.trackingId ?? null, JSON.stringify(job));
  _scheduleNext(job.campaignId);
}
function _next(campaignId) {
  return db.prepare(`SELECT * FROM delivery_send_queue WHERE campaign_id=? AND status='queued' ORDER BY created_at ASC LIMIT 1`).get() ?? null;
}
function _scheduleNext(campaignId) {
  const state = _state(campaignId);
  if (!state || state.paused || !_next(campaignId)) { if (timers.has(campaignId)) clearTimeout(timers.get(campaignId)); timers.delete(campaignId); return; }
  if (timers.has(campaignId)) return;
  const intervalMs = (3600 / Math.max(0.1, state.sends_per_hour)) * 1000;
  const jitter = intervalMs * 0.15;
  const delay = Math.max(0, intervalMs + (Math.random()*2-1)*jitter);
  const t = setTimeout(() => { timers.delete(campaignId); _processNext(campaignId).catch(() => {}); }, delay); t.unref(); timers.set(campaignId,t);
}
async function _processNext(campaignId) {
  const state = _state(campaignId);
  const row = _next(campaignId);
  if (!state || state.paused || !row) return;
  const claimed = db.prepare(`UPDATE delivery_send_queue SET status='processing', claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), attempts=attempts+1 WHERE id=? AND status='queued'`).run(row.id);
  if (!claimed.changes) return _scheduleNext(campaignId);
  const job = JSON.parse(row.job_json);
  try {
    if (!_mailer) throw new Error('delivery mailer not initialised');
    await _mailer.send(job);
    db.prepare(`DELETE FROM delivery_send_queue WHERE id=?`).run(row.id);
    db.prepare(`UPDATE delivery_queue_state SET sent=sent+1 WHERE campaign_id=?`).run(campaignId);
    _eventBus?.emit('delivery:email_sent', { campaignId, trackingId: job.trackingId, to: job.to, ts:new Date().toISOString() });
  } catch (err) {
    db.prepare(`UPDATE delivery_send_queue SET status='queued', last_error=? WHERE id=?`).run(String(err?.message ?? err), row.id);
    db.prepare(`UPDATE delivery_queue_state SET errors=errors+1 WHERE campaign_id=?`).run(campaignId);
    _eventBus?.emit('delivery:send_error', { campaignId, trackingId: job.trackingId, to: job.to, error: err.message, ts:new Date().toISOString() });
  }
  _scheduleNext(campaignId);
}
function recover() {
  const rows = db.prepare(`SELECT DISTINCT campaign_id FROM delivery_send_queue WHERE status='queued'`).all();
  for (const r of rows) _scheduleNext(r.campaign_id);
}
function pauseCampaign(campaignId) { _state(campaignId); db.prepare(`UPDATE delivery_queue_state SET paused=1 WHERE campaign_id=?`).run(campaignId); const t=timers.get(campaignId); if(t) clearTimeout(t); timers.delete(campaignId); }
function resumeCampaign(campaignId) { _state(campaignId); db.prepare(`UPDATE delivery_queue_state SET paused=0 WHERE campaign_id=?`).run(campaignId); _scheduleNext(campaignId); }
function size(campaignId) { return db.prepare(`SELECT COUNT(*) n FROM delivery_send_queue WHERE campaign_id=? AND status='queued'`).get(campaignId)?.n ?? 0; }
function clearCampaign(campaignId) { const t=timers.get(campaignId); if(t) clearTimeout(t); timers.delete(campaignId); db.prepare(`DELETE FROM delivery_send_queue WHERE campaign_id=?`).run(campaignId); db.prepare(`DELETE FROM delivery_queue_state WHERE campaign_id=?`).run(campaignId); }
function stop() { for (const t of timers.values()) clearTimeout(t); timers.clear(); }
function clearAll() { stop(); db.prepare(`DELETE FROM delivery_send_queue`).run(); db.prepare(`DELETE FROM delivery_queue_state`).run(); }
function stats(campaignId) { const s=db.prepare(`SELECT * FROM delivery_queue_state WHERE campaign_id=?`).get(campaignId); if(!s) return null; return { queued:size(campaignId), sent:s.sent, errors:s.errors, paused:!!s.paused }; }
module.exports={init,setMailer,setEventBus,recover,enqueue,pauseCampaign,resumeCampaign,size,clearCampaign,clearAll,stats};
