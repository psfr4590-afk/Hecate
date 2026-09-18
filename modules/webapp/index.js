'use strict';

const webappStore = require('./storage/webapp-store');
const scanner = require('./scanner/scanner');
const routes      = require('./api/routes');
let _initialised  = false;

function init(deps = {}) {
  if (_initialised) return;
  if (!deps.db) throw new Error('Webapp module requires deps.db');
  webappStore.init(deps.db);
  _initialised = true;
}

async function shutdown() { await scanner.shutdown(); _initialised = false; }

module.exports = { init, shutdown, routes };
