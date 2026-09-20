'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ensureOperatorCredentials, markInitialized } = require('./first-run');

test('first-run bootstrap creates local credentials without environment setup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hecate-bootstrap-'));
  const previous = { key: process.env.HECATE_KEY_PATH, token: process.env.HECATE_API_TOKEN };
  delete process.env.HECATE_KEY_PATH;
  delete process.env.HECATE_API_TOKEN;
  try {
    const result = ensureOperatorCredentials({ stateDir: dir });
    assert.equal(fs.statSync(result.keyPath).size, 32);
    const token = fs.readFileSync(result.tokenPath, 'utf8').trim();
    assert.match(token, /^[A-Za-z0-9_-]{32,256}$/);
    assert.equal(process.env.HECATE_KEY_PATH, result.keyPath);
    assert.equal(process.env.HECATE_API_TOKEN, token);
    markInitialized(result.stateDir);
    assert.equal(fs.existsSync(path.join(dir, '.initialized')), true);
  } finally {
    if (previous.key === undefined) delete process.env.HECATE_KEY_PATH; else process.env.HECATE_KEY_PATH = previous.key;
    if (previous.token === undefined) delete process.env.HECATE_API_TOKEN; else process.env.HECATE_API_TOKEN = previous.token;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
