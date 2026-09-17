'use strict';

/**
 * HECATE Delivery — Target Store
 * Tracks each target's state within a campaign.
 *
 * States (in progression):
 *   pending   → scheduled   → sent   → delivered
 *   delivered → opened      (open pixel fired)
 *   opened    → clicked     (link clicked)
 *   clicked   → submitted   (form submitted / credentials entered)
 *   any       → reported    (target reported the email — awareness metric)
 *   any       → bounced     (delivery failure)
 *
 * Multiple events per target are tracked (e.g. opened 3 times).
 * Events feed the campaign timeline.
 */

const { randomUUID } = require('crypto');

// Map<campaignId, Map<trackingId, TargetRecord>>
const campaigns = new Map();

// Map<trackingId, campaignId> — fast reverse lookup from beacon events
const trackingIndex = new Map();

function _camp(campaignId) {
  if (!campaigns.has(campaignId)) campaigns.set(campaignId, new Map());
  return campaigns.get(campaignId);
}

/**
 * Add targets to a campaign. Assigns tracking IDs.
 * @param {string}   campaignId
 * @param {object[]} targets     - normalised target objects
 * @returns {TargetRecord[]}
 */
function addTargets(campaignId, targets) {
  const camp   = _camp(campaignId);
  const records = [];

  for (const t of targets) {
    const trackingId = randomUUID();
    const record = {
      trackingId,
      campaignId,
      email:      t.email,
      firstName:  t.first_name  ?? '',
      lastName:   t.last_name   ?? '',
      company:    t.company     ?? '',
      title:      t.title       ?? '',
      custom:     t.custom      ?? {},
      state:      'pending',
      sentAt:     null,
      events:     [],
      addedAt:    new Date().toISOString(),
    };
    camp.set(trackingId, record);
    trackingIndex.set(trackingId, campaignId);
    records.push(record);
  }

  return records;
}

/**
 * Record an event for a target.
 * @param {string} trackingId
 * @param {string} eventType   — open | click | submit | report | bounce
 * @param {object} meta        — { ip, ua, url, data }
 */
function recordEvent(trackingId, eventType, meta = {}) {
  const campaignId = trackingIndex.get(trackingId);
  if (!campaignId) return null;

  const record = _camp(campaignId).get(trackingId);
  if (!record) return null;

  const event = {
    type: eventType,
    ts:   new Date().toISOString(),
    ip:   meta.ip  ?? null,
    ua:   meta.ua  ?? null,
    url:  meta.url ?? null,
    data: meta.data ?? null,
  };

  record.events.push(event);

  // Advance state machine
  const transitions = {
    scheduled: ['pending'],
    sent:      ['pending', 'scheduled'],
    bounce:    ['pending', 'scheduled', 'sent'],
    open:      ['sent', 'scheduled'],
    click:     ['sent', 'opened'],
    submit:    ['sent', 'opened', 'clicked'],
    report:    ['sent', 'opened', 'clicked', 'submitted'],
  };

  const STATE_RESULT = {
    scheduled: 'scheduled',
    sent:      'sent',
    bounce:    'bounced',
    open:      'opened',
    click:     'clicked',
    submit:    'submitted',
    report:    'reported',
  };

  const allowed = transitions[eventType];
  if (allowed?.includes(record.state)) {
    record.state = STATE_RESULT[eventType] ?? eventType;
  }

  if (eventType === 'sent') record.sentAt = event.ts;

  return event;
}

function getByTracking(trackingId) {
  const campaignId = trackingIndex.get(trackingId);
  if (!campaignId) return null;
  return _camp(campaignId).get(trackingId) ?? null;
}

function listByCampaign(campaignId, stateFilter) {
  const camp = campaigns.get(campaignId);
  if (!camp) return [];
  const all = [...camp.values()];
  return stateFilter ? all.filter(r => r.state === stateFilter) : all;
}

function stats(campaignId) {
  const targets = listByCampaign(campaignId);
  const total   = targets.length;
  const counts  = {};
  for (const t of targets) counts[t.state] = (counts[t.state] ?? 0) + 1;

  const sent      = total - (counts.pending ?? 0) - (counts.scheduled ?? 0);
  const opened    = counts.opened ?? 0;
  const clicked   = counts.clicked ?? 0;
  const submitted = counts.submitted ?? 0;

  return {
    total, sent, opened, clicked, submitted,
    bounced:   counts.bounced  ?? 0,
    reported:  counts.reported ?? 0,
    byState:   counts,
    openRate:    sent     ? +(opened    / sent     * 100).toFixed(1) : 0,
    clickRate:   sent     ? +(clicked   / sent     * 100).toFixed(1) : 0,
    submitRate:  sent     ? +(submitted / sent     * 100).toFixed(1) : 0,
    clickToOpen: opened   ? +(clicked   / opened   * 100).toFixed(1) : 0,
  };
}

function removeCampaign(campaignId) {
  const camp = campaigns.get(campaignId);
  if (camp) {
    for (const tid of camp.keys()) trackingIndex.delete(tid);
    campaigns.delete(campaignId);
  }
}

function clear() { campaigns.clear(); trackingIndex.clear(); }

module.exports = {
  addTargets, recordEvent, getByTracking,
  listByCampaign, stats, removeCampaign, clear,
};
