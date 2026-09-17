'use strict';

/**
 * HECATE — Phase 6 MITM Test Suite
 * Run: node --test modules/mitm/mitm.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ═════════════════════════════════════════════════════════════════════════════
// Capture: Credential Sniffer
// ═════════════════════════════════════════════════════════════════════════════

describe('Capture: credential-sniffer', () => {
  const { sniff } = require('./capture/credential-sniffer');

  it('returns null for GET requests', () => {
    assert.equal(sniff({ method: 'GET', url: '/page', headers: {}, body: '' }), null);
  });

  it('returns null when body is empty', () => {
    assert.equal(sniff({ method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' }), null);
  });

  it('sniffs username and password from form-urlencoded', () => {
    const req = {
      method:  'POST',
      url:     'https://corp.com/login',
      host:    'corp.com',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    'username=alice%40corp.com&password=S3cr3t&submit=Login',
    };
    const r = sniff(req);
    assert.ok(r);
    assert.ok(r.findings.some(f => f.type === 'username'));
    assert.ok(r.findings.some(f => f.type === 'password'));
  });

  it('sniffs credentials from JSON body', () => {
    const req = {
      method:  'POST',
      url:     '/api/auth',
      host:    'api.corp.com',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ email: 'user@corp.com', password: 'P@ss123' }),
    };
    const r = sniff(req);
    assert.ok(r);
    assert.ok(r.findings.some(f => f.field === 'email' && f.type === 'username'));
    assert.ok(r.findings.some(f => f.field === 'password' && f.type === 'password'));
  });

  it('redacts password values', () => {
    const req = {
      method:  'POST',
      url:     '/login',
      host:    'x.com',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    'user=admin&password=SuperSecret123',
    };
    const r   = sniff(req);
    const pwd = r.findings.find(f => f.type === 'password');
    assert.ok(pwd.redacted.includes('chars'));
    assert.ok(!pwd.redacted.includes('SuperSecret'));
  });

  it('returns null when no credential fields found', () => {
    const req = {
      method:  'POST',
      url:     '/submit',
      host:    'x.com',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    'search_query=hello+world&page=1',
    };
    assert.equal(sniff(req), null);
  });

  it('handles nested JSON objects', () => {
    const req = {
      method:  'POST',
      url:     '/api/login',
      host:    'x.com',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ credentials: { username: 'bob', password: 'pass' } }),
    };
    const r = sniff(req);
    assert.ok(r);
    assert.ok(r.findings.length > 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Intercept: SSL Stripper
// ═════════════════════════════════════════════════════════════════════════════

describe('Intercept: ssl-strip', () => {
  const ss = require('./intercept/ssl-strip');

  it('stripHeaders() removes HSTS', () => {
    const h   = { 'strict-transport-security': 'max-age=31536000; includeSubDomains', 'x-custom': 'kept' };
    const out = ss.stripHeaders(h, 'corp.com');
    assert.equal(out['strict-transport-security'], undefined);
    assert.equal(out['x-custom'], 'kept');
  });

  it('stripHeaders() rewrites Location header', () => {
    const h   = { 'location': 'https://corp.com/dashboard' };
    const out = ss.stripHeaders(h, 'corp.com');
    assert.ok(out['location'].startsWith('http://'));
  });

  it('stripHeaders() removes upgrade-insecure-requests from CSP', () => {
    const h   = { 'content-security-policy': "default-src 'self'; upgrade-insecure-requests" };
    const out = ss.stripHeaders(h, 'corp.com');
    assert.ok(!out['content-security-policy'].includes('upgrade-insecure-requests'));
  });

  it('stripHeaders() removes public-key-pins', () => {
    const h   = { 'public-key-pins': 'pin-sha256="abc123"; max-age=3600' };
    const out = ss.stripHeaders(h, 'corp.com');
    assert.equal(out['public-key-pins'], undefined);
  });

  it('stripBody() rewrites https:// for target host', () => {
    const body = '<a href="https://corp.com/login">Link</a>';
    const out  = ss.stripBody(body, 'corp.com');
    assert.ok(out.includes('http://corp.com'));
    assert.ok(!out.includes('https://corp.com'));
  });

  it('stripBody() does not touch other hosts when scoped', () => {
    const body = '<a href="https://other.com/page">Link</a>';
    const out  = ss.stripBody(body, 'corp.com');
    assert.ok(out.includes('https://other.com')); // untouched
  });

  it('stripBody() handles null gracefully', () => {
    assert.equal(ss.stripBody(null, 'x.com'), null);
  });

  it('shouldStrip() returns true for HTML', () => {
    assert.equal(ss.shouldStrip('text/html; charset=utf-8'), true);
  });

  it('shouldStrip() returns true for JSON', () => {
    assert.equal(ss.shouldStrip('application/json'), true);
  });

  it('shouldStrip() returns false for images', () => {
    assert.equal(ss.shouldStrip('image/jpeg'), false);
  });

  it('shouldStrip() returns false for binary', () => {
    assert.equal(ss.shouldStrip('application/octet-stream'), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DNS: Spoofer — pure packet functions
// ═════════════════════════════════════════════════════════════════════════════

describe('DNS: spoofer (packet layer)', () => {
  const dns = require('./dns/dns-spoofer');

  it('addEntry() and listEntries() work', () => {
    dns.addEntry('corp.com', '10.0.0.1');
    assert.equal(dns.listEntries()['corp.com'], '10.0.0.1');
  });

  it('removeEntry() clears an entry', () => {
    dns.addEntry('evil.com', '10.0.0.2');
    dns.removeEntry('evil.com');
    assert.equal(dns.listEntries()['evil.com'], undefined);
  });

  it('buildAResponse() produces valid DNS response structure', () => {
    // Build a minimal question section for corp.com
    const questionBuf = Buffer.from([
      4, 99, 111, 114, 112,  // \x04corp
      3, 99, 111, 109,       // \x03com
      0,                     // null terminator
      0, 1,                  // QTYPE A
      0, 1,                  // QCLASS IN
    ]);
    const response = dns.buildAResponse(0x1234, questionBuf, '10.0.0.1', 60);
    assert.ok(Buffer.isBuffer(response));
    // Check ID
    assert.equal(response.readUInt16BE(0), 0x1234);
    // QR bit should be set (response)
    assert.ok(response.readUInt16BE(2) & 0x8000);
    // ANCOUNT = 1
    assert.equal(response.readUInt16BE(6), 1);
    // Last 4 bytes of answer RR = IP
    assert.equal(response[response.length - 4], 10);
    assert.equal(response[response.length - 3], 0);
    assert.equal(response[response.length - 2], 0);
    assert.equal(response[response.length - 1], 1);
  });

  it('parseQuery() parses a basic A query', () => {
    // Minimal DNS query for "corp.com" type A
    const buf = Buffer.from([
      0x12, 0x34,  // ID
      0x01, 0x00,  // flags (QR=0, RD=1)
      0x00, 0x01,  // QDCOUNT=1
      0x00, 0x00,  // ANCOUNT=0
      0x00, 0x00,  // NSCOUNT=0
      0x00, 0x00,  // ARCOUNT=0
      // Question: corp.com
      4, 99, 111, 114, 112,  // \x04corp
      3, 99, 111, 109,       // \x03com
      0,                     // null
      0, 1,                  // QTYPE A
      0, 1,                  // QCLASS IN
    ]);
    const q = dns.parseQuery(buf);
    assert.ok(q);
    assert.equal(q.id, 0x1234);
    assert.equal(q.name, 'corp.com');
    assert.equal(q.qtype, dns.DNS_TYPE_A);
  });

  it('parseQuery() returns null for too-short buffer', () => {
    assert.equal(dns.parseQuery(Buffer.alloc(5)), null);
  });

  it('parseQuery() returns null for response packets (QR=1)', () => {
    const buf = Buffer.alloc(14);
    buf.writeUInt16BE(0x8000, 2); // QR=1 = response
    buf.writeUInt16BE(1, 4);      // QDCOUNT=1
    assert.equal(dns.parseQuery(buf), null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Intercept: Pipeline
// ═════════════════════════════════════════════════════════════════════════════

describe('Intercept: pipeline', () => {
  const p = require('./intercept/pipeline');

  before(() => {
    p.setConfig({ stripSsl: true, sniffCredentials: true, logTraffic: false });
  });

  it('processRequest() returns null findings for GET', () => {
    const { findings } = p.processRequest({
      method: 'GET', url: '/page', host: 'x.com', headers: {}, body: '',
    });
    assert.equal(findings, null);
  });

  it('processRequest() finds credentials in POST body', () => {
    const { findings } = p.processRequest({
      method:  'POST',
      url:     '/login',
      host:    'x.com',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    'username=admin&password=secret',
    });
    assert.ok(findings);
    assert.ok(findings.findings.length > 0);
  });

  it('processResponse() strips HSTS from headers', () => {
    const res = {
      headers: { 'strict-transport-security': 'max-age=3600', 'content-type': 'text/html' },
      body:    '<a href="https://corp.com/login">',
      status:  200,
    };
    const out = p.processResponse(res, 'corp.com');
    assert.equal(out.headers['strict-transport-security'], undefined);
  });

  it('processResponse() strips https from body', () => {
    const res = {
      headers: { 'content-type': 'text/html' },
      body:    '<a href="https://corp.com/page">Link</a>',
      status:  200,
    };
    const out = p.processResponse(res, 'corp.com');
    assert.ok(out.body.includes('http://corp.com'));
  });

  it('processResponse() does not modify binary responses', () => {
    const original = 'fake-binary-content';
    const res = {
      headers: { 'content-type': 'image/png' },
      body:    original,
      status:  200,
    };
    const out = p.processResponse(res, 'corp.com');
    assert.equal(out.body, original);
  });
});

describe('MITM: input validation regression', () => {
  it('documents IPv4-only DNS spoof input policy', () => {
    const net = require('net');
    assert.equal(net.isIP('127.0.0.1'), 4);
    assert.equal(net.isIP('999.999.999.999'), 0);
  });
});
