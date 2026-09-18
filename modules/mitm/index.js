'use strict';

const mitmStore  = require('./storage/mitm-store');
const dnsSpoofer = require('./dns/dns-spoofer');
const pipeline   = require('./intercept/pipeline');
const routes     = require('./api/routes');

let _initialised = false;

function init(deps = {}) {
  if (_initialised) return;
  const { db, eventBus, config } = deps;

  if (!db) throw new Error('MITM module requires deps.db');

  mitmStore.init(db);
  pipeline.setStore({
    logExchange: (data) => mitmStore.logExchange(data),
  });

  if (eventBus) {
    dnsSpoofer.setEventBus(eventBus);
    pipeline.setEventBus(eventBus);
  }

  if (config) pipeline.setConfig(config);

  _initialised = true;
}

async function shutdown() {
  if (dnsSpoofer.isRunning()) await dnsSpoofer.stop();
  _initialised = false;
}

module.exports = { init, shutdown, routes };
