'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'ui', 'src', 'components', 'Dashboard.jsx'), 'utf8');
const workspace = fs.readFileSync(path.join(__dirname, '..', 'ui', 'src', 'components', 'Workspace.jsx'), 'utf8');

const modules = ['recon','evil-proxy','c2','delivery','mitm','webapp','post-exploit'];
for (const name of modules) {
  assert.match(dashboard, new RegExp(`\\b${name}\\b`), `dashboard missing module surface: ${name}`);
  assert.match(workspace, new RegExp(`\\b${name}\\b`), `workspace missing module surface: ${name}`);
}

for (const phrase of ['CAPABILITY MAP','Full operator surface','moduleCapabilities','coreCapabilities']) {
  assert.ok(dashboard.includes(phrase), `dashboard capability surface missing: ${phrase}`);
}

for (const phrase of ['CONTROL SURFACE','Operator controls','module-control-grid','API surface','api.']) {
  assert.ok(workspace.includes(phrase), `module GUI control surface missing: ${phrase}`);
}

process.stdout.write('UI capability surface check passed.\n');
