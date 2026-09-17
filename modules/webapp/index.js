'use strict';

const webappStore = require('./storage/webapp-store');
const routes      = require('./api/routes');
let _initialised  = false;

function init(deps = {}) {
  if (_initialised) return;
  if (!deps.db) throw new Error('Webapp module requires deps.db');
  webappStore.init(deps.db);
  _initialised = true;
}

module.exports = { init, routes };
