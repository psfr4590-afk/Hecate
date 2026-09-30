'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

assert.match(pkg.version, /^1\\.0\\.0-rc\\.\\d+$/, 'release candidate must use 1.0.0-rc.N versioning');
assert.equal(lock.version, pkg.version, 'package-lock root version must match package.json');
assert.equal(lock.packages[''].version, pkg.version, 'package-lock package root version must match package.json');
assert.equal(pkg.engines.node, '>=22.13.0', 'supported Node floor must remain pinned');
assert.equal(lock.packages[''].engines.node, pkg.engines.node, 'lockfile Node floor must match package.json');
assert.equal(pkg.private, true, 'HECATE must remain a private deployable application package');

const required = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/FRESH-INSTALL.md',
  '.github/workflows/regression.yml',
  '.github/workflows/release.yml',
  'scripts/smoke-start.js',
  'scripts/check-ui-surface.js',
];

for (const relative of required) {
  assert.equal(fs.existsSync(path.join(root, relative)), true, `required release file missing: ${relative}`);
}

const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
for (const entry of ['node_modules/', 'data/', '*.sqlite3', '*.key', '.env']) {
  assert.ok(ignored.includes(entry), `runtime-secret isolation missing from .gitignore: ${entry}`);
}

const regression = fs.readFileSync(path.join(root, '.github/workflows/regression.yml'), 'utf8');
assert.match(regression, /npm ci/);
assert.match(regression, /npm run verify:release/);
assert.match(regression, /npm run smoke:start/);
assert.match(regression, /npm test/);
assert.match(regression, /npm run build:ui/);

const release = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
assert.match(release, /tags:/);
assert.match(release, /npm ci/);
assert.match(release, /npm run verify:release/);
assert.match(release, /npm pack/);

console.log(`HECATE release verification passed for ${pkg.version}`);
