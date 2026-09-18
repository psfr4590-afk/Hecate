'use strict';

/**
 * HECATE Delivery — durable target/tracking store.
 * SQLite is authoritative when initialised; Maps remain only as a lightweight
 * compatibility cache for isolated unit tests.
 */
const { randomUUID } = require('crypto');

const campaigns = new Map();
const trackingIndex = new Map();
let db = null;

function init(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_targets (
      tracking_id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      company TEXT,
      title TEXT,
      custom_json TEXT,
      state TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delivery_tracking_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      ip TEXT,
      ua TEXT,
      url TEXT,
      data_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_targets_campaign ON delivery_targets(campaign_id, state);
    CREATE INDEX IF NOT EXISTS idx_delivery_tracking_id ON delivery_tracking_events(tracking_id, ts);
  `);
  campaigns.clear(); trackingIndex.clear();
}

function addTargets(campaignId, targets) {
  const records = [];
  for (const t of targets) {
    const trackingId = randomUUID();
    const record = {
      trackingId, campaignId, email: t.email, firstName: t.first_name ?? '',
      lastName: t.last_name ?? '', company: t.company ?? '', title: t.title ?? '',
      custom: t.custom ?? {}, state: 'pending', sentAt: null, events: [],
      addedAt: new Date().toISOString(),
    };
    if (db) {
      db.prepare(`INSERT INTO delivery_targets
        (tracking_id,campaign_id,email,first_name,last_name,company,title,custom_json,state,added_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        trackingId,campaignId,record.email,record.firstName,record.lastName,
        record.company,record.title,JSON.stringify(record.custom),'pending',record.addedAt
      );
    }
    _cache(record);
    records.push(record);
  }
  return records;
}

function recordEvent(trackingId, eventType, meta = {}) {
  const record = getByTracking(trackingId);
  if (!record) return null;
  const event = {
    type: eventType, ts: new Date().toISOString(),
    ip: meta.ip ?? null, ua: meta.ua ?? null, url: meta.url ?? null,
    data: meta.data ?? null,
  };
  const transitions = {
    scheduled: ['pending'], sent: ['pending', 'scheduled'],
    bounce: ['pending', 'scheduled', 'sent'], open: ['sent', 'scheduled'],
    click: ['sent', 'opened'], submit: ['sent', 'opened', 'clicked'],
    report: ['sent', 'opened', 'clicked', 'submitted'],
  };
  const STATE_RESULT = { scheduled:'scheduled', sent:'sent', bounce:'bounced',
    open:'opened', click:'clicked', submit:'submitted', report:'reported' };
  if (db) {
    db.prepare(`INSERT INTO delivery_tracking_events
      (tracking_id,campaign_id,type,ts,ip,ua,url,data_json) VALUES (?,?,?,?,?,?,?,?)`)
      .run(trackingId, record.campaignId, eventType, event.ts, event.ip, event.ua,
        event.url, event.data == null ? null : JSON.stringify(event.data));
    const allowed = transitions[eventType];
    if (allowed?.includes(record.state)) {
      record.state = STATE_RESULT[eventType] ?? eventType;
      db.prepare('UPDATE delivery_targets SET state=?,sent_at=? WHERE tracking_id=?')
        .run(record.state, eventType === 'sent' ? event.ts : record.sentAt, trackingId);
    } else if (eventType === 'sent') {
      db.prepare('UPDATE delivery_targets SET sent_at=? WHERE tracking_id=?').run(event.ts, trackingId);
      record.sentAt = event.ts;
    }
    if (eventType === 'sent') record.sentAt = event.ts;
    return event;
  }
  record.events.push(event);
  const allowed = transitions[eventType];
  if (allowed?.includes(record.state)) record.state = STATE_RESULT[eventType] ?? eventType;
  if (eventType === 'sent') record.sentAt = event.ts;
  return event;
}

function getByTracking(trackingId) {
  if (db) {
    const r = db.prepare('SELECT * FROM delivery_targets WHERE tracking_id=?').get(trackingId);
    if (!r) return null;
    const events = db.prepare('SELECT * FROM delivery_tracking_events WHERE tracking_id=? ORDER BY id ASC').all(trackingId)
      .map(e => ({ type:e.type, ts:e.ts, ip:e.ip, ua:e.ua, url:e.url, data:e.data_json ? JSON.parse(e.data_json) : null }));
    return _fromRow(r, events);
  }
  const campaignId = trackingIndex.get(trackingId);
  return campaignId ? campaigns.get(campaignId)?.get(trackingId) ?? null : null;
}

function listByCampaign(campaignId, stateFilter) {
  if (db) {
    const rows = db.prepare(`SELECT * FROM delivery_targets WHERE campaign_id=?${stateFilter ? ' AND state=?' : ''} ORDER BY added_at ASC`)
      .all(...(stateFilter ? [campaignId, stateFilter] : [campaignId]));
    return rows.map(r => _fromRow(r, []));
  }
  const camp = campaigns.get(campaignId);
  if (!camp) return [];
  const all = [...camp.values()];
  return stateFilter ? all.filter(r => r.state === stateFilter) : all;
}

function stats(campaignId) {
  const targets = listByCampaign(campaignId);
  const total = targets.length, counts = {};
  for (const t of targets) counts[t.state] = (counts[t.state] ?? 0) + 1;
  const sent = total - (counts.pending ?? 0) - (counts.scheduled ?? 0);
  const opened = counts.opened ?? 0, clicked = counts.clicked ?? 0, submitted = counts.submitted ?? 0;
  return {
    total, sent, opened, clicked, submitted, bounced: counts.bounced ?? 0,
    reported: counts.reported ?? 0, byState: counts,
    openRate: sent ? +(opened / sent * 100).toFixed(1) : 0,
    clickRate: sent ? +(clicked / sent * 100).toFixed(1) : 0,
    submitRate: sent ? +(submitted / sent * 100).toFixed(1) : 0,
    clickToOpen: opened ? +(clicked / opened * 100).toFixed(1) : 0,
  };
}

function count(campaignId) {
  return db ? db.prepare('SELECT COUNT(*) n FROM delivery_targets WHERE campaign_id=?').get(campaignId)?.n ?? 0
            : listByCampaign(campaignId).length;
}

function removeCampaign(campaignId) {
  if (db) {
    db.prepare('DELETE FROM delivery_tracking_events WHERE campaign_id=?').run(campaignId);
    db.prepare('DELETE FROM delivery_targets WHERE campaign_id=?').run(campaignId);
  }
  const camp = campaigns.get(campaignId);
  if (camp) for (const tid of camp.keys()) trackingIndex.delete(tid);
  campaigns.delete(campaignId);
}

function _cache(record) {
  if (!campaigns.has(record.campaignId)) campaigns.set(record.campaignId, new Map());
  campaigns.get(record.campaignId).set(record.trackingId, record);
  trackingIndex.set(record.trackingId, record.campaignId);
}
function _fromRow(r, events) {
  return {
    trackingId:r.tracking_id, campaignId:r.campaign_id, email:r.email,
    firstName:r.first_name ?? '', lastName:r.last_name ?? '',
    company:r.company ?? '', title:r.title ?? '',
    custom:r.custom_json ? JSON.parse(r.custom_json) : {},
    state:r.state, sentAt:r.sent_at, events, addedAt:r.added_at,
  };
}
function clear() {
  if (db) { db.prepare('DELETE FROM delivery_tracking_events').run(); db.prepare('DELETE FROM delivery_targets').run(); }
  campaigns.clear(); trackingIndex.clear();
}

module.exports = { init, addTargets, recordEvent, getByTracking, listByCampaign, stats, count, removeCampaign, clear };
