'use strict';

/**
 * HECATE Delivery — Campaign Manager
 * Manages campaign lifecycle: draft → ready → running → paused → complete
 *
 * The campaign manager coordinates:
 *   - Template rendering per target
 *   - Send queue population
 *   - Rate limiting (sends/hour)
 *   - Event routing from tracking beacons
 *   - Campaign stats aggregation
 */

const { randomUUID }      = require('crypto');
const renderer            = require('../template/renderer');
const { validateTargetList } = require('../template/validator');
const targetStore         = require('../target/target-store');
const sendQueue           = require('../send/send-queue');

// Map<campaignId, Campaign>
const campaigns = new Map();
let _eventBus   = null;

function setEventBus(bus) { _eventBus = bus; }

const VALID_TRANSITIONS = {
  draft:    ['ready', 'deleted'],
  ready:    ['running', 'draft', 'deleted'],
  running:  ['paused', 'complete', 'deleted'],
  paused:   ['running', 'complete', 'deleted'],
  complete: ['deleted'],
  deleted:  [],
};

/**
 * Create a new campaign.
 */
function create({ engagementId, name, templateId, template, trackingBase,
                  sendsPerHour = 60, fromName, fromEmail, smtpProfileId }) {
  if (!name)        throw new Error('name required');
  if (!trackingBase) throw new Error('trackingBase required');

  const id = randomUUID();
  const campaign = {
    id,
    engagementId,
    name,
    templateId,
    template,         // inline template object (alternative to templateId)
    trackingBase,
    sendsPerHour,
    fromName,
    fromEmail,
    smtpProfileId,
    state:      'draft',
    createdAt:  new Date().toISOString(),
    startedAt:  null,
    completedAt: null,
    error:      null,
    _targets:   [],   // loaded when campaign goes ready
  };
  campaigns.set(id, campaign);
  return campaign;
}

/**
 * Add targets to a campaign (must be in draft or ready state).
 */
function addTargets(campaignId, rawTargets) {
  const camp = _get(campaignId);
  _assertState(camp, ['draft', 'ready']);

  const { validTargets, errors } = validateTargetList(rawTargets);
  if (errors.length && validTargets.length === 0) {
    throw new Error(`All targets invalid: ${errors.slice(0, 3).join('; ')}`);
  }

  const records = targetStore.addTargets(campaignId, validTargets);
  camp._targets.push(...records);

  _emit('delivery:targets_added', {
    campaignId, count: records.length, errors
  });

  return { added: records.length, errors };
}

/**
 * Transition campaign state.
 */
function transition(campaignId, toState) {
  const camp  = _get(campaignId);
  const valid = VALID_TRANSITIONS[camp.state] ?? [];
  if (!valid.includes(toState)) {
    throw new Error(`Cannot transition from '${camp.state}' to '${toState}'`);
  }

  camp.state = toState;

  if (toState === 'running')  {
    camp.startedAt = new Date().toISOString();
    _scheduleAll(camp);
  }
  if (toState === 'complete') camp.completedAt = new Date().toISOString();
  if (toState === 'paused')   sendQueue.pauseCampaign(campaignId);

  _emit(`delivery:campaign_${toState}`, { campaignId, name: camp.name });
  return camp;
}

/**
 * Schedule all pending targets into the send queue.
 */
function _scheduleAll(campaign) {
  const pending = targetStore.listByCampaign(campaign.id, 'pending');

  for (const target of pending) {
    const vars    = renderer.buildVars(target, target.trackingId);
    const tpl     = campaign.template;
    const subject = renderer.substitute(tpl.subject ?? '', vars);
    const html    = renderer.render(tpl.htmlBody ?? '', vars, {
      trackingId:   target.trackingId,
      trackingBase: campaign.trackingBase,
      injectPixel:  true,
      wrapLinks:    true,
    });
    const text = tpl.textBody
      ? renderer.substitute(tpl.textBody, vars)
      : null;

    sendQueue.enqueue({
      campaignId:   campaign.id,
      engagementId:  campaign.engagementId,
      trackingId:   target.trackingId,
      to:           target.email,
      fromName:     campaign.fromName,
      fromEmail:    campaign.fromEmail,
      subject,
      html,
      text,
      smtpProfileId: campaign.smtpProfileId,
      sendsPerHour:  campaign.sendsPerHour,
    });

    targetStore.recordEvent(target.trackingId, 'scheduled', {});
  }

  _emit('delivery:campaign_scheduled', {
    campaignId: campaign.id,
    queued: pending.length,
  });
}

function get(campaignId) { return campaigns.get(campaignId) ?? null; }

function list(engagementId) {
  const all = [...campaigns.values()];
  return engagementId ? all.filter(c => c.engagementId === engagementId) : all;
}

function stats(campaignId) {
  const camp    = _get(campaignId);
  const targets = targetStore.stats(campaignId);
  return {
    campaignId,
    name:       camp.name,
    state:      camp.state,
    startedAt:  camp.startedAt,
    ...targets,
    queueSize:  sendQueue.size(campaignId),
  };
}

function remove(campaignId) {
  campaigns.delete(campaignId);
  targetStore.removeCampaign(campaignId);
  sendQueue.clearCampaign(campaignId);
}

function clear() {
  campaigns.clear();
  targetStore.clear();
  sendQueue.clearAll();
}

function _get(id) {
  const c = campaigns.get(id);
  if (!c) throw new Error(`Campaign not found: ${id}`);
  return c;
}

function _assertState(camp, allowed) {
  if (!allowed.includes(camp.state)) {
    throw new Error(`Operation requires state in [${allowed}], got '${camp.state}'`);
  }
}

function _emit(event, data) {
  _eventBus?.emit(event, { ...data, ts: new Date().toISOString() });
}

module.exports = {
  setEventBus, create, addTargets, transition,
  get, list, stats, remove, clear,
};
