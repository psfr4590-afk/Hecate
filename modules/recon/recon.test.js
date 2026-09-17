'use strict';

/**
 * HECATE — Phase 3 Recon Test Suite
 * Tests all recon sub-components in isolation.
 * No network calls — fetcher and DB are mocked where needed.
 *
 * Run: node --test modules/recon/recon.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ═════════════════════════════════════════════════════════════════════════════
// STEALTH: Profiles
// ═════════════════════════════════════════════════════════════════════════════

describe('Stealth: profiles', () => {
  const profiles = require('./stealth/profiles');

  it('lists all built-in profiles', () => {
    assert.ok(profiles.PROFILE_NAMES.length >= 5);
    assert.ok(profiles.PROFILE_NAMES.includes('chrome-win'));
    assert.ok(profiles.PROFILE_NAMES.includes('firefox-linux'));
  });

  it('get() returns a valid profile', () => {
    const p = profiles.get('chrome-win');
    assert.ok(p.ua.includes('Chrome'));
    assert.ok(typeof p.jitterMs[0] === 'number');
  });

  it('get() throws on unknown profile', () => {
    assert.throws(() => profiles.get('nonexistent'), /Unknown stealth profile/);
  });

  it('buildHeaders() merges profile + overrides', () => {
    const h = profiles.buildHeaders('chrome-win', { Cookie: 'session=abc' });
    assert.ok(h['User-Agent'].includes('Chrome'));
    assert.equal(h['Cookie'], 'session=abc');
    assert.ok(h['Accept']);
  });

  it('jitter() returns a number in the profile range', () => {
    const p = profiles.get('chrome-win');
    for (let i = 0; i < 20; i++) {
      const j = profiles.jitter('chrome-win');
      assert.ok(j >= p.jitterMs[0] && j <= p.jitterMs[1]);
    }
  });

  it('sleep() resolves after delay', async () => {
    const start = Date.now();
    await profiles.sleep(20);
    assert.ok(Date.now() - start >= 15);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEALTH: Rate Limiter
// ═════════════════════════════════════════════════════════════════════════════

describe('Stealth: rate-limiter', () => {
  const RateLimiter = require('./stealth/rate-limiter');

  it('allows burst requests immediately', async () => {
    const rl    = new RateLimiter({ ratePerSec: 10, burst: 5 });
    const start = Date.now();
    for (let i = 0; i < 5; i++) await rl.acquire('test.com');
    assert.ok(Date.now() - start < 100, 'burst should be fast');
  });

  it('throttles requests above burst', async () => {
    const rl    = new RateLimiter({ ratePerSec: 100, burst: 1 });
    const start = Date.now();
    await rl.acquire('a.com');
    await rl.acquire('a.com'); // 2nd should wait
    assert.ok(Date.now() - start >= 5, 'should have waited');
  });

  it('tracks separate buckets per hostname', async () => {
    const rl = new RateLimiter({ ratePerSec: 1000, burst: 2 });
    await rl.acquire('host1.com');
    await rl.acquire('host2.com');
    const stats = rl.stats();
    assert.ok(stats['host1.com']);
    assert.ok(stats['host2.com']);
  });

  it('reset() clears bucket for a host', async () => {
    const rl = new RateLimiter({ ratePerSec: 1000, burst: 2 });
    await rl.acquire('target.com');
    rl.reset('target.com');
    const stats = rl.stats();
    assert.equal(stats['target.com'], undefined);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ENGINE: Frontier
// ═════════════════════════════════════════════════════════════════════════════

describe('Engine: frontier', () => {
  const Frontier = require('./engine/frontier');

  it('seeds and pops URLs in priority order', () => {
    const f = new Frontier({ seedHost: 'example.com', scope: 'strict' });
    f.seed(['https://example.com/']);
    f.push('https://example.com/page', 1);
    f.push('https://example.com/app.js', 1);

    const first = f.pop();
    assert.equal(first.depth, 0, 'seed (depth 0) should have highest priority');
  });

  it('deduplicates URLs', () => {
    const f = new Frontier({ seedHost: 'example.com', scope: 'strict' });
    f.push('https://example.com/page', 1);
    f.push('https://example.com/page', 1);
    assert.equal(f.size, 1);
  });

  it('respects scope: strict — rejects other hosts', () => {
    const f = new Frontier({ seedHost: 'example.com', scope: 'strict' });
    assert.equal(f.push('https://evil.com/', 1), false);
    assert.equal(f.push('https://example.com/page', 1), true);
  });

  it('respects scope: subdomain — allows subdomains', () => {
    const f = new Frontier({ seedHost: 'example.com', scope: 'subdomain' });
    assert.equal(f.push('https://sub.example.com/page', 1), true);
    assert.equal(f.push('https://evil.com/', 1), false);
  });

  it('respects scope: none — allows everything', () => {
    const f = new Frontier({ seedHost: 'example.com', scope: 'none' });
    assert.equal(f.push('https://whatever.io/', 1), true);
  });

  it('filters excluded extensions', () => {
    const f = new Frontier({ seedHost: 'example.com', scope: 'strict' });
    assert.equal(f.push('https://example.com/image.png', 1), false);
    assert.equal(f.push('https://example.com/font.woff2', 1), false);
    assert.equal(f.push('https://example.com/script.js', 1), true);
  });

  it('respects maxDepth', () => {
    const f = new Frontier({ seedHost: 'example.com', maxDepth: 2 });
    assert.equal(f.push('https://example.com/deep', 3), false);
    assert.equal(f.push('https://example.com/ok', 2), true);
  });

  it('marks visited on pop', () => {
    const f = new Frontier({ seedHost: 'example.com' });
    f.push('https://example.com/page', 1);
    f.pop();
    assert.equal(f.push('https://example.com/page', 1), false, 'already visited');
  });

  it('stats() returns correct counts', () => {
    const f = new Frontier({ seedHost: 'example.com' });
    f.push('https://example.com/a', 1);
    f.push('https://example.com/b', 1);
    const s = f.stats();
    assert.equal(s.queued, 2);
  });

  it('normalize() strips fragment', () => {
    const f   = new Frontier({ seedHost: 'example.com' });
    const n1  = f.normalize('https://example.com/page#section');
    const n2  = f.normalize('https://example.com/page');
    assert.equal(n1, n2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ENGINE: Parser
// ═════════════════════════════════════════════════════════════════════════════

describe('Engine: parser', () => {
  const { parse } = require('./engine/parser');

  const SAMPLE = `
    <html>
    <head>
      <title>Login Page</title>
      <meta name="generator" content="WordPress 6.4">
      <meta name="description" content="Test site">
    </head>
    <body>
      <a href="/dashboard">Dashboard</a>
      <a href="https://cdn.example.com/lib.js">CDN</a>
      <img src="/images/logo.png">
      <script src="/app.js"></script>
      <script>var apiKey = "AKIA1234567890ABCDEF";</script>
      <form action="/login" method="POST">
        <input type="text" name="username">
        <input type="password" name="password">
      </form>
      <!-- TODO: remove debug flag before prod -->
    </body>
    </html>
  `;

  let result;
  before(() => { result = parse(SAMPLE, 'https://example.com/'); });

  it('extracts page title', () => {
    assert.equal(result.title, 'Login Page');
  });

  it('extracts links', () => {
    assert.ok(result.links.some(l => l.includes('/dashboard')));
  });

  it('extracts script URLs', () => {
    assert.ok(result.scriptUrls.some(s => s.includes('/app.js')));
  });

  it('extracts inline scripts', () => {
    assert.ok(result.inlineScripts.some(s => s.includes('apiKey')));
  });

  it('extracts HTML comments', () => {
    assert.ok(result.comments.some(c => c.includes('debug flag')));
  });

  it('extracts forms with fields', () => {
    assert.equal(result.forms.length, 1);
    assert.equal(result.forms[0].method, 'POST');
    assert.ok(result.forms[0].fields.some(f => f.name === 'password'));
  });

  it('extracts meta tags', () => {
    assert.ok(result.meta['generator']?.includes('WordPress'));
    assert.ok(result.meta['description']);
  });

  it('resolves relative links to absolute', () => {
    assert.ok(result.links.every(l => l.startsWith('http')));
  });

  it('returns empty result on null body', () => {
    const r = parse(null, 'https://example.com/');
    assert.equal(r.links.length, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ANALYSIS: Tech Fingerprinter
// ═════════════════════════════════════════════════════════════════════════════

describe('Analysis: tech-fingerprint', () => {
  const { fingerprint } = require('./analysis/tech-fingerprint');

  it('detects nginx from server header', () => {
    const r = { headers: { server: 'nginx/1.24.0' }, body: '' };
    const f = fingerprint(r);
    assert.equal(f.server, 'nginx');
  });

  it('detects PHP from X-Powered-By', () => {
    const r = { headers: { 'x-powered-by': 'PHP/8.2.0' }, body: '' };
    const f = fingerprint(r);
    assert.equal(f.language, 'PHP');
  });

  it('detects Cloudflare from cf-ray header', () => {
    const r = { headers: { 'cf-ray': 'abc123-LHR' }, body: '' };
    const f = fingerprint(r);
    assert.ok(f.hasCdn);
    assert.ok(f.summary.includes('Cloudflare'));
  });

  it('detects WordPress from body', () => {
    const r = { headers: {}, body: '<link rel="stylesheet" href="/wp-content/themes/x/style.css">' };
    const f = fingerprint(r);
    assert.equal(f.cms, 'WordPress');
  });

  it('detects WordPress from meta generator', () => {
    const r = { headers: {}, body: '' };
    const p = { meta: { generator: 'WordPress 6.4.2' } };
    const f = fingerprint(r, p);
    assert.equal(f.cms, 'WordPress');
  });

  it('detects NTLM auth from WWW-Authenticate', () => {
    const r = { headers: { 'www-authenticate': 'NTLM' }, body: '' };
    const f = fingerprint(r);
    assert.ok(f.detections.some(d => d.tech === 'NTLM'));
  });

  it('detects Next.js from body pattern', () => {
    const r = { headers: {}, body: '<script src="/_next/static/chunk.js">' };
    const f = fingerprint(r);
    assert.ok(f.detections.some(d => d.tech === 'Next.js'));
  });

  it('returns empty detections for plain response', () => {
    const r = { headers: {}, body: '<html><body>Hello</body></html>' };
    const f = fingerprint(r);
    assert.ok(Array.isArray(f.detections));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ANALYSIS: Secret Scanner
// ═════════════════════════════════════════════════════════════════════════════

describe('Analysis: secret-scanner', () => {
  const { scan, entropy, redact } = require('./analysis/secret-scanner');

  it('detects AWS access key', () => {
    const body = 'var key = "AKIAIOSFODNN7EXAMPLE";';
    const r = scan(body, 'https://example.com/app.js');
    assert.ok(r.some(f => f.type === 'aws-access-key'), 'should find aws-access-key');
  });

  it('detects JWT token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const r = scan(`Authorization: Bearer ${jwt}`, 'test.js');
    assert.ok(r.some(f => f.type === 'jwt'));
  });

  it('detects database connection string', () => {
    const body = 'const db = "postgres://user:pass@localhost:5432/mydb";';
    const r = scan(body, 'test.js');
    assert.ok(r.some(f => f.type === 'db-connection-string'));
  });

  it('detects private key marker', () => {
    const body = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...';
    const r = scan(body, 'test.js');
    assert.ok(r.some(f => f.type === 'private-key'));
  });

  it('detects GitHub token', () => {
    const body = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk';
    const r = scan(body, 'test.js');
    assert.ok(r.some(f => f.type === 'github-token'));
  });

  it('detects Stripe key', () => {
    const body = 'stripe.init("STRIPE_TEST_KEY_PLACEHOLDER")';
    const r = scan(body, 'test.js');
    assert.ok(r.some(f => f.type === 'stripe-key'));
  });

  it('detects high-entropy strings', () => {
    const body = 'var secret = "aB3xQr7mN9kLpZ2yWvTuFsEd";';
    const r = scan(body, 'test.js');
    assert.ok(r.some(f => f.type === 'high-entropy-string'));
  });

  it('deduplicates identical findings', () => {
    const body = 'AKIAIOSFODNN7EXAMPLE AKIAIOSFODNN7EXAMPLE';
    const r = scan(body, 'test.js');
    const awsKeys = r.filter(f => f.type === 'aws-access-key');
    assert.equal(awsKeys.length, 1, 'should deduplicate');
  });

  it('redact() shows only prefix + length', () => {
    assert.equal(redact('AKIAIOSFODNN7EXAMPLE'), 'AKIA…[20]');
    assert.equal(redact('abc'), '[REDACTED]');
  });

  it('entropy() is higher for random strings', () => {
    const low  = entropy('aaaaaaaaaa');
    const high = entropy('aB3xQr7mN9');
    assert.ok(high > low);
  });

  it('returns empty array on null body', () => {
    assert.deepEqual(scan(null, 'test.js'), []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ANALYSIS: Semantic Classifier
// ═════════════════════════════════════════════════════════════════════════════

describe('Analysis: semantic', () => {
  const { classify } = require('./analysis/semantic');

  it('classifies login page', () => {
    const r = classify({ url: 'https://example.com/login', body: '<input type="password" name="password">', title: 'Login', status: 200 });
    assert.equal(r.type, 'login');
  });

  it('classifies admin page', () => {
    const r = classify({ url: 'https://example.com/admin/dashboard', title: 'Admin Dashboard', body: '', status: 200 });
    assert.equal(r.type, 'admin');
  });

  it('classifies API endpoint', () => {
    const r = classify({ url: 'https://example.com/api/v1/users', body: '', title: '', headers: { 'content-type': 'application/json' }, status: 200 });
    assert.equal(r.type, 'api');
  });

  it('classifies file upload form', () => {
    const r = classify({ url: 'https://example.com/upload', body: '<input type="file">', title: '', status: 200 });
    assert.equal(r.type, 'upload');
  });

  it('classifies debug page', () => {
    const r = classify({ url: 'https://example.com/debug', body: 'phpinfo()', title: '', status: 200 });
    assert.equal(r.type, 'debug');
  });

  it('classifies error page from status', () => {
    const r = classify({ url: 'https://example.com/missing', body: '', title: 'Error', status: 500 });
    assert.equal(r.type, 'error');
  });

  it('classifies backup file', () => {
    const r = classify({ url: 'https://example.com/database.sql.bak', body: '', title: '', status: 200 });
    assert.equal(r.type, 'backup');
  });

  it('classifies config file', () => {
    const r = classify({ url: 'https://example.com/.env', body: 'DB_HOST=localhost\nAPI_KEY=secret', title: '', status: 200 });
    assert.equal(r.type, 'config');
  });

  it('returns generic for plain page', () => {
    const r = classify({ url: 'https://example.com/about', body: '<p>About us</p>', title: 'About', status: 200 });
    assert.equal(r.type, 'generic');
  });

  it('provides confidence level', () => {
    const r = classify({ url: '/login', body: '<input type="password">', title: 'Login', status: 200 });
    assert.ok(['high', 'medium', 'low'].includes(r.confidence));
  });
});
