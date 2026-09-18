'use strict';

const campaignManager = require('./campaign/campaign-manager');
const sendQueue       = require('./send/send-queue');
const mailer          = require('./send/mailer');
const tracker         = require('./tracking/tracker');
const routes          = require('./api/routes');

let _initialised = false;

function init(deps = {}) {
  if (_initialised) return;
  const { eventBus, dryRun, db } = deps;

  if (!db) throw new Error('Delivery module requires deps.db');
  sendQueue.init(db);

  if (eventBus) {
    campaignManager.setEventBus(eventBus);
    sendQueue.setEventBus(eventBus);
    tracker.setEventBus(eventBus);
    mailer.setEventBus(eventBus);
  }

  if (dryRun) mailer.setDryRun(true);

  sendQueue.setMailer(mailer);
  sendQueue.recover();
  _initialised = true;
}

function shutdown() { sendQueue.stop(); }

module.exports = { init, shutdown, routes };
