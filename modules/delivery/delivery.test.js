'use strict';

/**
 * HECATE — Phase 6 Delivery Test Suite
 * Run: node --test modules/delivery/delivery.test.js
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const sendQueue = require('./send/send-queue');
sendQueue.init(new DatabaseSync(':memory:'));

// ═════════════════════════════════════════════════════════════════════════════
// Template: Renderer
// ═════════════════════════════════════════════════════════════════════════════

describe('Template: renderer', () => {
  const r = require('./template/renderer');

  it('substitute() replaces known vars', () => {
    const out = r.substitute('Hello {{first_name}}!', { first_name: 'Alice' });
    assert.equal(out, 'Hello Alice!');
  });

  it('substitute() leaves unknown vars blank by default', () => {
    const out = r.substitute('{{unknown}}', {});
    assert.equal(out, '');
  });

  it('substitute() preserves unknown when leaveUnknown=true', () => {
    const out = r.substitute('{{x}}', {}, true);
    assert.equal(out, '{{x}}');
  });

  it('wrapLinks() wraps href links', () => {
    const html = '<a href="https://corp.com/login">Login</a>';
    const out  = r.wrapLinks(html, 'https://phish.io', 'tid-1');
    assert.ok(out.includes('phish.io'));
    assert.ok(out.includes('/__t/click/tid-1/'));
    assert.ok(out.includes('u='));
  });

  it('wrapLinks() skips mailto: links', () => {
    const html = '<a href="mailto:x@y.com">email</a>';
    const out  = r.wrapLinks(html, 'https://phish.io', 'tid-1');
    assert.ok(out.includes('mailto:x@y.com'));
  });

  it('wrapLinks() skips already-wrapped links', () => {
    const html = `<a href="https://phish.io/__t/click/abc/0?u=x">link</a>`;
    const out  = r.wrapLinks(html, 'https://phish.io', 'other');
    // Should not double-wrap
    assert.ok(!out.includes('/__t/click/other/'));
  });

  it('injectPixel() inserts before </body>', () => {
    const html = '<html><body><p>Hello</p></body></html>';
    const out  = r.injectPixel(html, 'https://phish.io', 'tid-2');
    assert.ok(out.includes('/__t/open/tid-2'));
    assert.ok(out.indexOf('<img') < out.indexOf('</body>'));
  });

  it('injectPixel() appends when no </body>', () => {
    const html = '<p>Fragment</p>';
    const out  = r.injectPixel(html, 'https://phish.io', 'tid-3');
    assert.ok(out.includes('/__t/open/tid-3'));
  });

  it('extractVars() finds all template variables', () => {
    const vars = r.extractVars('Hello {{first_name}} from {{company}}!');
    assert.deepEqual(vars.sort(), ['company', 'first_name']);
  });

  it('buildVars() normalises target fields', () => {
    const target = { first_name: 'Bob', last_name: 'Smith', email: 'bob@corp.com', company: 'Corp' };
    const vars   = r.buildVars(target, 'tid-99');
    assert.equal(vars.full_name, 'Bob Smith');
    assert.equal(vars.company,   'Corp');
    assert.equal(vars.tracking_id, 'tid-99');
  });

  it('render() applies substitution + pixel + link wrapping', () => {
    const html = '<html><body><a href="https://corp.com">Link</a> {{first_name}}</body></html>';
    const out  = r.render(html, { first_name: 'Carol' }, {
      trackingId: 'T1', trackingBase: 'https://p.io'
    });
    assert.ok(out.includes('Carol'));
    assert.ok(out.includes('p.io'));
    assert.ok(out.includes('__t/open'));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Template: Validator
// ═════════════════════════════════════════════════════════════════════════════

describe('Template: validator', () => {
  const { validate, validateTargetList } = require('./template/validator');

  const VALID_TPL = {
    name:      'Test Template',
    subject:   'Important: {{first_name}}',
    htmlBody:  '<html><body>Hello {{first_name}} {{tracking_id}}</body></html>',
    fromEmail: 'sender@phish.io',
  };

  it('validates a correct template', () => {
    const r = validate(VALID_TPL);
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
  });

  it('returns error on missing name', () => {
    const r = validate({ ...VALID_TPL, name: '' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('name')));
  });

  it('returns error on invalid fromEmail', () => {
    const r = validate({ ...VALID_TPL, fromEmail: 'not-an-email' });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('fromEmail')));
  });

  it('warns when tracking_id missing', () => {
    const r = validate({ ...VALID_TPL, htmlBody: '<body>No tracking</body>' });
    assert.ok(r.warnings.some(w => w.includes('tracking_id')));
  });

  it('warns on <script> in htmlBody', () => {
    const r = validate({ ...VALID_TPL, htmlBody: '<script>alert(1)</script> {{tracking_id}}' });
    assert.ok(r.warnings.some(w => w.includes('script')));
  });

  it('validateTargetList() accepts valid targets', () => {
    const r = validateTargetList([
      { email: 'a@corp.com', first_name: 'A' },
      { email: 'b@corp.com', first_name: 'B' },
    ]);
    assert.equal(r.valid, true);
    assert.equal(r.validTargets.length, 2);
  });

  it('validateTargetList() rejects missing email', () => {
    const r = validateTargetList([{ first_name: 'No Email' }]);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('missing email')));
  });

  it('validateTargetList() rejects duplicate emails', () => {
    const r = validateTargetList([
      { email: 'dup@x.com' }, { email: 'dup@x.com' }
    ]);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some(e => e.includes('duplicate')));
  });

  it('validateTargetList() normalises email to lowercase', () => {
    const r = validateTargetList([{ email: 'UPPER@CORP.COM' }]);
    assert.equal(r.validTargets[0].email, 'upper@corp.com');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Target: List Parser
// ═════════════════════════════════════════════════════════════════════════════

describe('Target: list-parser', () => {
  const { parseCSV, dedup } = require('./target/list-parser');

  const SAMPLE_CSV = `email,first_name,last_name,company
alice@corp.com,Alice,Smith,Acme
bob@corp.com,Bob,Jones,Acme
charlie@other.org,Charlie,Brown,Other`;

  it('parseCSV() parses headers and rows', () => {
    const { targets, errors } = parseCSV(SAMPLE_CSV);
    assert.equal(targets.length, 3);
    assert.equal(errors.length, 0);
  });

  it('parseCSV() maps first_name correctly', () => {
    const { targets } = parseCSV(SAMPLE_CSV);
    assert.equal(targets[0].first_name, 'Alice');
    assert.equal(targets[0].last_name, 'Smith');
  });

  it('parseCSV() skips rows with missing email', () => {
    const csv = `email,first_name\nalice@x.com,Alice\n,NoEmail`;
    const { targets, errors } = parseCSV(csv);
    assert.equal(targets.length, 1);
    assert.equal(errors.length, 1);
  });

  it('parseCSV() handles quoted fields with commas', () => {
    const csv = `email,company\ntest@x.com,"Acme, Inc."`;
    const { targets } = parseCSV(csv);
    assert.equal(targets[0].company, 'Acme, Inc.');
  });

  it('parseCSV() stores unknown columns in custom{}', () => {
    const csv = `email,department\ntest@x.com,Engineering`;
    const { targets } = parseCSV(csv);
    assert.equal(targets[0].department, 'Engineering');
  });

  it('dedup() removes duplicate emails (keeps first)', () => {
    const targets = [
      { email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'a@x.com' }
    ];
    const r = dedup(targets);
    assert.equal(r.length, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Target: Target Store
// ═════════════════════════════════════════════════════════════════════════════

describe('Target: target-store', () => {
  const ts = require('./target/target-store');

  before(() => ts.clear());

  it('addTargets() assigns tracking IDs', () => {
    const records = ts.addTargets('camp-1', [
      { email: 'a@corp.com', first_name: 'A' },
    ]);
    assert.equal(records.length, 1);
    assert.ok(records[0].trackingId);
  });

  it('recordEvent() transitions state', () => {
    const [r] = ts.addTargets('camp-2', [{ email: 'b@corp.com' }]);
    ts.recordEvent(r.trackingId, 'sent',  {});
    ts.recordEvent(r.trackingId, 'open',  { ip: '1.2.3.4' });
    ts.recordEvent(r.trackingId, 'click', { url: 'https://x.com' });

    const rec = ts.getByTracking(r.trackingId);
    assert.equal(rec.state, 'clicked');
    assert.equal(rec.events.length, 3);
  });

  it('recordEvent() does not regress state', () => {
    const [r] = ts.addTargets('camp-3', [{ email: 'c@corp.com' }]);
    ts.recordEvent(r.trackingId, 'sent',  {});
    ts.recordEvent(r.trackingId, 'click', {});  // skip open — still valid
    ts.recordEvent(r.trackingId, 'open',  {});  // open after click — no regression
    const rec = ts.getByTracking(r.trackingId);
    assert.equal(rec.state, 'clicked');
  });

  it('getByTracking() returns null for unknown id', () => {
    assert.equal(ts.getByTracking('no-such-id'), null);
  });

  it('stats() computes rates', () => {
    ts.clear();
    const targets = [
      { email: 'x1@c.com' }, { email: 'x2@c.com' }, { email: 'x3@c.com' },
    ];
    const records = ts.addTargets('camp-stats', targets);
    ts.recordEvent(records[0].trackingId, 'sent', {});
    ts.recordEvent(records[1].trackingId, 'sent', {});
    ts.recordEvent(records[0].trackingId, 'open', {});

    const s = ts.stats('camp-stats');
    assert.equal(s.total, 3);
    assert.equal(s.sent, 2);
    assert.equal(s.opened, 1);
    assert.equal(s.openRate, 50.0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Tracking: Tracker
// ═════════════════════════════════════════════════════════════════════════════

describe('Tracking: tracker', () => {
  const tk = require('./tracking/tracker');
  const ts = require('./target/target-store');

  before(() => ts.clear());

  let trackingId;

  before(() => {
    const [r] = ts.addTargets('camp-track', [{ email: 'victim@corp.com' }]);
    ts.recordEvent(r.trackingId, 'sent', {});
    trackingId = r.trackingId;
  });

  it('handleOpen() returns a transparent GIF', () => {
    const r = tk.handleOpen(trackingId, { ip: '1.2.3.4' });
    assert.equal(r.status, 200);
    assert.equal(r.contentType, 'image/gif');
    assert.ok(Buffer.isBuffer(r.body));
    assert.equal(r.body.length, tk.PIXEL_GIF.length);
  });

  it('handleOpen() records event on known trackingId', () => {
    const before = ts.getByTracking(trackingId).events.length;
    tk.handleOpen(trackingId, { ip: '5.6.7.8' });
    const after = ts.getByTracking(trackingId).events.length;
    assert.equal(after, before + 1);
  });

  it('handleOpen() works silently on unknown trackingId', () => {
    assert.doesNotThrow(() => tk.handleOpen('no-such-id', {}));
  });

  it('handleClick() returns 302 redirect', () => {
    const dest = 'https://corp.com/login';
    const r    = tk.handleClick(trackingId, '0', dest, { ip: '1.1.1.1' });
    assert.equal(r.status, 302);
    assert.equal(r.redirect, dest);
  });

  it('handleClick() blocks javascript: redirect', () => {
    const r = tk.handleClick(trackingId, '0', 'javascript:alert(1)', {});
    assert.equal(r.redirect, '/');
  });

  it('handleSubmit() returns 200 JSON', () => {
    const r = tk.handleSubmit(trackingId, { fields: { username: 'admin', password: 'secret' } }, {});
    assert.equal(r.status, 200);
    assert.equal(r.contentType, 'application/json');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Campaign: Manager
// ═════════════════════════════════════════════════════════════════════════════

describe('Campaign: manager', () => {
  const cm = require('./campaign/campaign-manager');

  before(() => cm.clear());

  const TPL = {
    subject:  'Action required, {{first_name}}',
    htmlBody: '<body>Click here {{tracking_id}}</body>',
    textBody: 'Click here {{tracking_id}}',
    fromEmail: 'hr@corp.com',
  };

  it('create() returns a draft campaign', () => {
    const c = cm.create({ engagementId: 'e1', name: 'Test', template: TPL, trackingBase: 'https://p.io' });
    assert.equal(c.state, 'draft');
    assert.ok(c.id);
  });

  it('addTargets() adds targets to draft campaign', () => {
    const c  = cm.create({ engagementId: 'e1', name: 'T2', template: TPL, trackingBase: 'https://p.io' });
    const r  = cm.addTargets(c.id, [{ email: 'a@x.com' }, { email: 'b@x.com' }]);
    assert.equal(r.added, 2);
  });

  it('addTargets() rejects all-invalid target list', () => {
    const c = cm.create({ engagementId: 'e1', name: 'T3', template: TPL, trackingBase: 'https://p.io' });
    assert.throws(() => cm.addTargets(c.id, [{ email: '' }, { email: 'bad' }]), /invalid/);
  });

  it('transition() advances state correctly', () => {
    const c = cm.create({ engagementId: 'e1', name: 'T4', template: TPL, trackingBase: 'https://p.io' });
    cm.transition(c.id, 'ready');
    assert.equal(cm.get(c.id).state, 'ready');
  });

  it('transition() throws on invalid transition', () => {
    const c = cm.create({ engagementId: 'e1', name: 'T5', template: TPL, trackingBase: 'https://p.io' });
    assert.throws(() => cm.transition(c.id, 'complete'), /Cannot transition/);
  });

  it('stats() returns campaign stats', () => {
    const c = cm.create({ engagementId: 'e1', name: 'T6', template: TPL, trackingBase: 'https://p.io' });
    cm.addTargets(c.id, [{ email: 'q@x.com' }]);
    const s = cm.stats(c.id);
    assert.equal(s.total, 1);
    assert.ok(typeof s.openRate === 'number');
  });

  it('list() filters by engagementId', () => {
    cm.clear();
    cm.create({ engagementId: 'eid-A', name: 'CA', template: TPL, trackingBase: 'https://p.io' });
    cm.create({ engagementId: 'eid-B', name: 'CB', template: TPL, trackingBase: 'https://p.io' });
    assert.equal(cm.list('eid-A').length, 1);
    assert.equal(cm.list('eid-B').length, 1);
    assert.equal(cm.list().length, 2);
  });
});
