'use strict';

/**
 * HECATE Delivery — durable campaign manager.
 * Campaign definitions are persisted in SQLite; the in-memory Map is only a
 * runtime cache. Queued sends can therefore be explained and resumed after a
 * process restart.
 */
const { randomUUID } = require('crypto');
const renderer = require('../template/renderer');
const { validateTargetList } = require('../template/validator');
const targetStore = require('../target/target-store');
const sendQueue = require('../send/send-queue');

const campaigns = new Map();
let _db = null;
let _eventBus = null;

function init(db) {
  _db = db;
  _db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_campaigns (
      id TEXT PRIMARY KEY,
      engagement_id TEXT NOT NULL,
      name TEXT NOT NULL,
      template_id TEXT,
      template_json TEXT,
      tracking_base TEXT NOT NULL,
      sends_per_hour REAL NOT NULL DEFAULT 60,
      from_name TEXT,
      from_email TEXT,
      smtp_profile_id TEXT,
      state TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_campaigns_engagement
      ON delivery_campaigns(engagement_id, created_at);
  `);
  campaigns.clear();
  for (const row of _db.prepare('SELECT * FROM delivery_campaigns ORDER BY created_at ASC').all()) {
    campaigns.set(row.id, _fromRow(row));
  }
}

function setEventBus(bus) { _eventBus = bus; }

const VALID_TRANSITIONS = {
  draft: ['ready', 'deleted'],
  ready: ['running', 'draft', 'deleted'],
  running: ['paused', 'complete', 'deleted'],
  paused: ['running', 'complete', 'deleted'],
  complete: ['deleted'],
  deleted: [],
};

function create({ engagementId, name, templateId, template, trackingBase,
                  sendsPerHour = 60, fromName, fromEmail, smtpProfileId }) {
  if (!name) throw new Error('name required');
  if (!trackingBase) throw new Error('trackingBase required');

  const id = randomUUID();
  const campaign = {
    id, engagementId, name, templateId, template, trackingBase, sendsPerHour,
    fromName, fromEmail, smtpProfileId, state: 'draft',
    createdAt: new Date().toISOString(), startedAt: null,
    completedAt: null, error: null, _targets: [],
  };
  if (_db) {
    _db.prepare(`INSERT INTO delivery_campaigns
      (id,engagement_id,name,template_id,template_json,tracking_base,sends_per_hour,
       from_name,from_email,smtp_profile_id,state,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, engagementId, name, templateId ?? null, template ? JSON.stringify(template) : null,
      trackingBase, sendsPerHour, fromName ?? null, fromEmail ?? null,
      smtpProfileId ?? null, 'draft', campaign.createdAt
    );
  }
  campaigns.set(id, campaign);
  return campaign;
}

function addTargets(campaignId, rawTargets) {
  const camp = _get(campaignId);
  _assertState(camp, ['draft', 'ready']);
  const { validTargets, errors } = validateTargetList(rawTargets);
  if (errors.length && validTargets.length === 0) {
    throw new Error(`All targets invalid: ${errors.slice(0, 3).join('; ')}`);
  }
  const records = targetStore.addTargets(campaignId, validTargets);
  if (!_db) camp._targets.push(...records);
  _emit('delivery:targets_added', { campaignId, count: records.length, errors });
  return { added: records.length, errors };
}

function transition(campaignId, toState) {
  const camp = _get(campaignId);
  const valid = VALID_TRANSITIONS[camp.state] ?? [];
  if (!valid.includes(toState)) throw new Error(`Cannot transition from '${camp.state}' to '${toState}'`);

  camp.state = toState;
  if (toState === 'running') {
    camp.startedAt = new Date().toISOString();
    _scheduleAll(camp);
  }
  if (toState === 'complete') camp.completedAt = new Date().toISOString();
  if (toState === 'paused') sendQueue.pauseCampaign(campaignId);

  _persist(camp);
  _emit(`delivery:campaign_${toState}`, { campaignId, name: camp.name });
  return camp;
}

function _scheduleAll(campaign) {
  const pending = targetStore.listByCampaign(campaign.id, 'pending');
  for (const target of pending) {
    const vars = renderer.buildVars(target, target.trackingId);
    const tpl = campaign.template ?? {};
    const subject = renderer.substitute(tpl.subject ?? '', vars);
    const html = renderer.render(tpl.htmlBody ?? '', vars, {
      trackingId: target.trackingId, trackingBase: campaign.trackingBase,
      injectPixel: true, wrapLinks: true,
    });
    const text = tpl.textBody ? renderer.substitute(tpl.textBody, vars) : null;
    sendQueue.enqueue({
      campaignId: campaign.id, engagementId: campaign.engagementId,
      trackingId: target.trackingId, to: target.email,
      fromName: campaign.fromName, fromEmail: campaign.fromEmail,
      subject, html, text, smtpProfileId: campaign.smtpProfileId,
      sendsPerHour: campaign.sendsPerHour,
    });
    targetStore.recordEvent(target.trackingId, 'scheduled', {});
  }
  _emit('delivery:campaign_scheduled', { campaignId: campaign.id, queued: pending.length });
}

function get(campaignId) { return campaigns.get(campaignId) ?? null; }

function list(engagementId) {
  const all = [...campaigns.values()];
  return engagementId ? all.filter(c => c.engagementId === engagementId) : all;
}

function stats(campaignId) {
  const camp = _get(campaignId);
  return {
    campaignId, name: camp.name, state: camp.state, startedAt: camp.startedAt,
    ...targetStore.stats(campaignId), queueSize: sendQueue.size(campaignId),
  };
}

function remove(campaignId) {
  campaigns.delete(campaignId);
  targetStore.removeCampaign(campaignId);
  sendQueue.clearCampaign(campaignId);
  _db?.prepare('DELETE FROM delivery_campaigns WHERE id=?').run(campaignId);
}

function clear() {
  campaigns.clear();
  targetStore.clear();
  sendQueue.clearAll();
  _db?.prepare('DELETE FROM delivery_campaigns').run();
}

function _persist(c) {
  if (!_db) return;
  _db.prepare(`UPDATE delivery_campaigns SET state=?,started_at=?,completed_at=?,error=? WHERE id=?`)
    .run(c.state, c.startedAt, c.completedAt, c.error, c.id);
}

function _fromRow(r) {
  return {
    id: r.id, engagementId: r.engagement_id, name: r.name, templateId: r.template_id,
    template: r.template_json ? JSON.parse(r.template_json) : null,
    trackingBase: r.tracking_base, sendsPerHour: r.sends_per_hour,
    fromName: r.from_name, fromEmail: r.from_email, smtpProfileId: r.smtp_profile_id,
    state: r.state, createdAt: r.created_at, startedAt: r.started_at,
    completedAt: r.completed_at, error: r.error, _targets: [],
  };
}

function _get(id) {
  const c = campaigns.get(id);
  if (!c) throw new Error(`Campaign not found: ${id}`);
  return c;
}
function _assertState(camp, allowed) {
  if (!allowed.includes(camp.state)) throw new Error(`Operation requires state in [${allowed}], got '${camp.state}'`);
}
function _emit(event, data) { _eventBus?.emit(event, { ...data, ts: new Date().toISOString() }); }

module.exports = { init, setEventBus, create, addTargets, transition, get, list, stats, remove, clear };
