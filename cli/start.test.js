'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const { validateStartOptions } = require('./commands/start');

describe('CLI start configuration validation', () => {
  const base = () => ({
    port: '7331',
    host: '127.0.0.1',
    db: path.join(os.tmpdir(), 'hecate-start-validation', 'hecate.db'),
  });

  it('accepts a valid local configuration', () => {
    const result = validateStartOptions(base());
    assert.equal(result.port, 7331);
    assert.equal(result.host, '127.0.0.1');
    assert.ok(result.dbPath.endsWith(path.join('hecate-start-validation', 'hecate.db')));
  });

  it('rejects invalid ports', () => {
    for (const port of ['0', '65536', '-1', 'abc']) {
      assert.throws(() => validateStartOptions({ ...base(), port }), /Invalid port/);
    }
  });

  it('rejects an empty host', () => {
    assert.throws(() => validateStartOptions({ ...base(), host: '   ' }), /Host/);
  });
});
