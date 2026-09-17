'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Webapp: check-library', () => {
  const { runAll, checkSqlError, checkXssReflection, checkLfi, checkOpenRedirect,
          checkSecurityHeaders, checkInfoDisclosure, checkInterestingFile,
          checkCors, checkDirListing, XSS_CANARY, REDIRECT_CANARY } = require('./checks/check-library');

  const baseReq = { url: 'https://corp.com/test', method: 'GET', headers: {} };
  const baseRes = { status: 200, headers: { 'content-type': 'text/html' }, body: '' };

  it('checkSqlError() detects MySQL error', () => {
    const r = checkSqlError(baseReq, { ...baseRes, body: "You have an error in your SQL syntax near 'id'" });
    assert.equal(r.vulnerable, true);
    assert.equal(r.severity, 'high');
  });

  it('checkSqlError() misses clean response', () => {
    assert.equal(checkSqlError(baseReq, { ...baseRes, body: '<p>Hello</p>' }).vulnerable, false);
  });

  it('checkSqlError() detects ORA error', () => {
    const r = checkSqlError(baseReq, { ...baseRes, body: 'ORA-01756: quoted string not properly terminated' });
    assert.equal(r.vulnerable, true);
  });

  it('checkXssReflection() detects reflected canary in HTML', () => {
    const r = checkXssReflection(baseReq, { ...baseRes, body: `<p>${XSS_CANARY}</p>` });
    assert.equal(r.vulnerable, true);
    assert.equal(r.severity, 'high');
  });

  it('checkXssReflection() misses when canary absent', () => {
    assert.equal(checkXssReflection(baseReq, { ...baseRes, body: '<p>safe</p>' }).vulnerable, false);
  });

  it('checkLfi() detects /etc/passwd content', () => {
    const r = checkLfi(baseReq, { ...baseRes, body: 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:' });
    assert.equal(r.vulnerable, true);
    assert.equal(r.severity, 'critical');
  });

  it('checkOpenRedirect() detects canary in Location header', () => {
    const r = checkOpenRedirect(baseReq, { ...baseRes, status: 302, headers: { location: REDIRECT_CANARY } });
    assert.equal(r.vulnerable, true);
  });

  it('checkOpenRedirect() misses legitimate redirect', () => {
    const r = checkOpenRedirect(baseReq, { ...baseRes, status: 302, headers: { location: 'https://corp.com/dashboard' } });
    assert.equal(r.vulnerable, false);
  });

  it('checkSecurityHeaders() flags missing HSTS', () => {
    const r = checkSecurityHeaders(baseReq, { ...baseRes, headers: { 'content-type': 'text/html' } });
    assert.equal(r.vulnerable, true);
    assert.ok(r.detail.includes('strict-transport-security'));
  });

  it('checkSecurityHeaders() passes when all headers present', () => {
    const res = { ...baseRes, headers: {
      'strict-transport-security': 'max-age=31536000',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'x-xss-protection': '1; mode=block',
      'content-security-policy': "default-src 'self'",
      'referrer-policy': 'strict-origin',
      'permissions-policy': 'geolocation=()',
    }};
    assert.equal(checkSecurityHeaders(baseReq, res).vulnerable, false);
  });

  it('checkInfoDisclosure() detects X-Powered-By', () => {
    const r = checkInfoDisclosure(baseReq, { ...baseRes, headers: { 'x-powered-by': 'PHP/8.2.1' } });
    assert.equal(r.vulnerable, true);
  });

  it('checkInfoDisclosure() detects Python traceback', () => {
    const r = checkInfoDisclosure(baseReq, { ...baseRes, body: 'Traceback (most recent call last):\n  File "app.py"' });
    assert.equal(r.vulnerable, true);
  });

  it('checkInterestingFile() flags .git/config exposure', () => {
    const r = checkInterestingFile(
      { ...baseReq, url: 'https://corp.com/.git/config' },
      { ...baseRes, body: '[core]\n\trepositoryformatversion = 0' }
    );
    assert.equal(r.vulnerable, true);
    assert.equal(r.severity, 'high');
  });

  it('checkInterestingFile() flags .env exposure', () => {
    const r = checkInterestingFile(
      { ...baseReq, url: 'https://corp.com/.env' },
      { ...baseRes, body: 'DB_HOST=localhost\nAPI_KEY=secret123' }
    );
    assert.equal(r.vulnerable, true);
    assert.equal(r.severity, 'critical');
  });

  it('checkCors() detects wildcard + credentials', () => {
    const r = checkCors(baseReq, { ...baseRes, headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-credentials': 'true'
    }});
    assert.equal(r.vulnerable, true);
    assert.equal(r.severity, 'high');
  });

  it('checkCors() allows non-credential wildcard at low severity', () => {
    const r = checkCors(baseReq, { ...baseRes, headers: { 'access-control-allow-origin': '*' } });
    assert.equal(r.vulnerable, true);
    assert.equal(r.severity, 'low');
  });

  it('checkDirListing() detects Apache index', () => {
    const r = checkDirListing(baseReq, { ...baseRes, body: '<h1>Index of /uploads/</h1><a href="../">Parent Directory</a>' });
    assert.equal(r.vulnerable, true);
  });

  it('runAll() returns array of findings', () => {
    const res = { status: 200, headers: { 'x-powered-by': 'PHP/7.4' }, body: 'You have an error in your SQL syntax' };
    const findings = runAll(baseReq, res);
    assert.ok(Array.isArray(findings));
    assert.ok(findings.length >= 2);
    assert.ok(findings.every(f => f.checkId && f.severity));
  });
});

describe('Webapp: fuzzer', () => {
  const { dirFuzz, paramFuzz, vhostFuzz, isHit, templateFuzz } = require('./checks/fuzzer');

  it('dirFuzz() generates requests for each word', () => {
    const reqs = dirFuzz('https://corp.com', { words: ['admin', 'login', 'api'], extensions: [''] });
    assert.equal(reqs.length, 3);
    assert.ok(reqs[0].url.includes('corp.com/admin'));
    assert.equal(reqs[0].fuzzTarget, 'directory');
  });

  it('dirFuzz() applies extensions', () => {
    const reqs = dirFuzz('https://corp.com', { words: ['config'], extensions: ['.php', '.bak'] });
    assert.equal(reqs.length, 2);
    assert.ok(reqs.some(r => r.url.includes('config.php')));
    assert.ok(reqs.some(r => r.url.includes('config.bak')));
  });

  it('paramFuzz() generates one request per param+payload combo', () => {
    const reqs = paramFuzz('https://corp.com/page', ['id', 'user'], { payloads: ["'", '"'] });
    assert.equal(reqs.length, 4);
    assert.ok(reqs[0].url.includes('id='));
    assert.equal(reqs[0].fuzzTarget, 'parameter');
  });

  it('vhostFuzz() sets Host header', () => {
    const reqs = vhostFuzz('http://10.0.0.1', 'corp.com', ['dev', 'staging']);
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0].headers.host, 'dev.corp.com');
    assert.equal(reqs[0].fuzzTarget, 'vhost');
  });

  it('templateFuzz() replaces FUZZ marker', () => {
    const reqs = templateFuzz('https://corp.com/FUZZ', ['admin', 'api']);
    assert.equal(reqs.length, 2);
    assert.ok(reqs[0].url.includes('admin'));
    assert.ok(!reqs[0].url.includes('FUZZ'));
  });

  it('isHit() returns false for 404', () => {
    assert.equal(isHit({}, { status: 404 }, null), false);
  });

  it('isHit() returns true for 200 vs 404 baseline', () => {
    assert.equal(isHit({}, { status: 200, body: '' }, { status: 404, bodyLength: 0 }), true);
  });

  it('isHit() detects significant body length change', () => {
    assert.equal(isHit({}, { status: 200, body: 'x'.repeat(500) }, { status: 200, bodyLength: 10 }), true);
  });
});

describe('Webapp: wordlist', () => {
  const wl = require('./scanner/wordlist');

  it('DIRS contains common admin paths', () => {
    assert.ok(wl.DIRS.includes('admin'));
    assert.ok(wl.DIRS.includes('wp-admin'));
    assert.ok(wl.DIRS.includes('.env'));
  });

  it('PARAMS contains common injection params', () => {
    assert.ok(wl.PARAMS.includes('id'));
    assert.ok(wl.PARAMS.includes('redirect'));
  });

  it('get() returns built-in list', () => {
    const dirs = wl.get('dirs');
    assert.ok(dirs.length >= wl.DIRS.length);
  });

  it('INTERESTING_FILES contains high-value targets', () => {
    assert.ok(wl.INTERESTING_FILES.includes('.env'));
    assert.ok(wl.INTERESTING_FILES.includes('.git/config'));
  });
});


describe('Webapp: scanner network policy', () => {
  const scanner = require('./scanner/scanner');

  it('defaults to blocking private targets and bounds redirects', () => {
    assert.equal(scanner.DEFAULT_CONFIG.allowPrivateTargets, false);
    assert.equal(scanner.DEFAULT_CONFIG.maxRedirects, 5);
    assert.equal(scanner.DEFAULT_CONFIG.followRedirects, true);
  });
});

describe('Webapp: response-size policy', () => {
  it('keeps the configured response body ceiling explicit', () => {
    const scanner = require('./scanner/scanner');
    assert.ok(Number.isFinite(scanner.DEFAULT_CONFIG.maxBodyBytes));
    assert.ok(scanner.DEFAULT_CONFIG.maxBodyBytes > 0);
  });
});
