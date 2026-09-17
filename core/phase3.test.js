'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');

const Database = require('./db/database');
const ssrf = require('../modules/recon/target/ssrf-guard');

let dbPath;

beforeEach(() => {
  dbPath = path.join(process.cwd(), `phase3-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  Database.init({ path: dbPath });
});

afterEach(() => {
  Database.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
});

test('Phase 3 SSRF guard rejects private and special-use destinations by default', async () => {
  await assert.rejects(() => ssrf.validateUrl('http://127.0.0.1/'), /private|special-use/i);
  await assert.rejects(() => ssrf.validateUrl('http://169.254.169.254/latest/meta-data/'), /private|special-use/i);
  await assert.rejects(() => ssrf.validateUrl('file:///etc/passwd'), /HTTP\(S\)/i);
});

test('Phase 3 SSRF guard permits explicit private-target mode for authorized internal engagements', async () => {
  const parsed = await ssrf.validateUrl('http://127.0.0.1/', { allowPrivate: true });
  assert.equal(parsed.hostname, '127.0.0.1');
});
