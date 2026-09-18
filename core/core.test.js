'use strict';

/**
 * HECATE — Core Test Suite
 * Tests all core subsystems against a real in-memory SQLite database.
 * Run: node --experimental-sqlite --test core/core.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const crypto  = require('crypto');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');

// ── Bootstrap: in-memory DB + temp key ───────────────────────────────────────

const DB_PATH  = path.join(os.tmpdir(), `hecate-core-test-${Date.now()}.db`);
const KEY_PATH = path.join(os.tmpdir(), `hecate-core-test-${Date.now()}.key`);

before(async () => {
  // Write a test key
  fs.writeFileSync(KEY_PATH, crypto.randomBytes(32));
  // Init DB
  const Database = require('./db/database');
  Database.init({ path: DB_PATH });
  // Load key
  const KeyManager = require('./crypto/key-manager');
  await KeyManager.load(KEY_PATH);
});

after(() => {
  try { fs.unlinkSync(DB_PATH); } catch {}
  try { fs.unlinkSync(KEY_PATH); } catch {}
});

// ═══════════════════════════════════════════════════════════════════════════════
// Crypto: KeyManager
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: KeyManager', () => {
  const KeyManager = require('./crypto/key-manager');

  it('isLoaded() returns true after load', () => {
    assert.equal(KeyManager.isLoaded(), true);
  });

  it('encrypt() returns a base64 string', async () => {
    const enc = await KeyManager.encrypt('hello world');
    assert.equal(typeof enc, 'string');
    assert.ok(enc.length > 20);
  });

  it('decrypt() round-trips correctly', async () => {
    const plain  = 'super secret 🔐';
    const enc    = await KeyManager.encrypt(plain);
    const dec    = await KeyManager.decrypt(enc);
    assert.equal(dec, plain);
  });

  it('each encrypt() produces a unique ciphertext', async () => {
    const e1 = await KeyManager.encrypt('same');
    const e2 = await KeyManager.encrypt('same');
    assert.notEqual(e1, e2);
  });

  it('decrypt() throws on tampered ciphertext', async () => {
    const enc = await KeyManager.encrypt('test');
    const buf = Buffer.from(enc, 'base64');
    buf[buf.length - 5] ^= 0xFF;
    await assert.rejects(() => KeyManager.decrypt(buf.toString('base64')));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB: Engagement model
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: Engagement model', () => {
  const Engagement = require('./db/models/engagement');
  let eid;

  it('create() returns an ID', () => {
    eid = Engagement.create({ name: 'Test Op', scope: 'lab.corp.com' });
    assert.ok(typeof eid === 'string' && eid.length > 10);
  });

  it('findById() returns the created engagement', () => {
    const e = Engagement.findById(eid);
    assert.equal(e.name, 'Test Op');
    assert.equal(e.scope, 'lab.corp.com');
    assert.equal(e.status, 'active');
  });

  it('list() includes the new engagement', () => {
    const all = Engagement.list();
    assert.ok(all.some(e => e.id === eid));
  });

  it('update() changes fields', () => {
    Engagement.update(eid, { status: 'complete', description: 'Done' });
    const e = Engagement.findById(eid);
    assert.equal(e.status, 'complete');
    assert.equal(e.description, 'Done');
  });

  it('findById() returns null for unknown id', () => {
    assert.equal(Engagement.findById('no-such-id'), null);
  });

  it('remove() deletes the engagement', () => {
    const tempId = Engagement.create({ name: 'Temp' });
    Engagement.remove(tempId);
    assert.equal(Engagement.findById(tempId), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB: Target model
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: Target model', () => {
  const Engagement = require('./db/models/engagement');
  const Target     = require('./db/models/target');
  let eid, tid;

  before(() => { eid = Engagement.create({ name: 'Target Test Op' }); });

  it('upsert() creates a new target', () => {
    tid = Target.upsert({ engagementId: eid, type: 'host', value: '10.0.0.1', label: 'DC01' });
    assert.ok(tid);
  });

  it('findById() retrieves target', () => {
    const t = Target.findById(tid);
    assert.equal(t.value, '10.0.0.1');
    assert.equal(t.label, 'DC01');
  });

  it('upsert() deduplicates on (eid, type, value)', () => {
    const tid2 = Target.upsert({ engagementId: eid, type: 'host', value: '10.0.0.1', label: 'DC01-updated' });
    assert.equal(tid2, tid);
    assert.equal(Target.findById(tid).label, 'DC01-updated');
  });

  it('findByEngagement() lists targets for engagement', () => {
    Target.upsert({ engagementId: eid, type: 'url', value: 'https://corp.com' });
    const all = Target.findByEngagement(eid);
    assert.ok(all.length >= 2);
    assert.ok(all.every(t => t.engagement_id === eid));
  });

  it('update() changes status', () => {
    Target.update(tid, { status: 'compromised' });
    assert.equal(Target.findById(tid).status, 'compromised');
  });

  it('remove() deletes target', () => {
    const temp = Target.upsert({ engagementId: eid, type: 'ip', value: '1.2.3.4' });
    Target.remove(temp);
    assert.equal(Target.findById(temp), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DB: Evidence + Finding models
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: Evidence model', () => {
  const Engagement = require('./db/models/engagement');
  const Evidence   = require('./db/models/evidence');
  let eid, evid;

  before(() => { eid = Engagement.create({ name: 'Evidence Test Op' }); });

  it('create() returns an ID', () => {
    evid = Evidence.create({ engagementId: eid, type: 'recon:url', module: 'recon', label: 'Login page', data: '{"url":"https://corp.com/login"}' });
    assert.ok(evid);
  });

  it('findById() retrieves evidence', () => {
    const e = Evidence.findById(evid);
    assert.equal(e.type, 'recon:url');
    assert.equal(e.module, 'recon');
  });

  it('findByEngagement() returns all evidence for engagement', () => {
    Evidence.create({ engagementId: eid, type: 'recon:secret', module: 'recon', label: 'AWS key found' });
    const all = Evidence.findByEngagement(eid);
    assert.ok(all.length >= 2);
  });

  it('remove() deletes evidence', () => {
    Evidence.remove(evid);
    assert.equal(Evidence.findById(evid), null);
  });
});

describe('Core: Finding model', () => {
  const Engagement = require('./db/models/engagement');
  const Finding    = require('./db/models/finding');
  let eid, fid;

  before(() => { eid = Engagement.create({ name: 'Finding Test Op' }); });

  it('create() returns an ID', () => {
    fid = Finding.create({ engagementId: eid, title: 'SQL Injection', severity: 'high', module: 'webapp', description: 'Error-based SQLi on /login' });
    assert.ok(fid);
  });

  it('findById() retrieves finding', () => {
    const f = Finding.findById(fid);
    assert.equal(f.title, 'SQL Injection');
    assert.equal(f.severity, 'high');
  });

  it('findByEngagement() returns findings', () => {
    Finding.create({ engagementId: eid, title: 'XSS', severity: 'medium', module: 'webapp' });
    const all = Finding.findByEngagement(eid);
    assert.ok(all.length >= 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Store: CredentialStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: CredentialStore', () => {
  const Engagement      = require('./db/models/engagement');
  const CredentialStore = require('./store/credential-store');
  let eid, credId;

  before(() => { eid = Engagement.create({ name: 'Cred Test Op' }); });

  it('store() encrypts and saves', async () => {
    credId = await CredentialStore.store({ engagementId: eid, type: 'password', username: 'admin', secret: 'P@ssw0rd!' });
    assert.ok(credId);
  });

  it('list() excludes secret value', () => {
    const rows = CredentialStore.list(eid);
    assert.ok(rows.length >= 1);
    assert.ok(rows.every(r => !r.secret && !r.secret_enc));
  });

  it('retrieve() decrypts correctly', async () => {
    const cred = await CredentialStore.retrieve(credId);
    assert.equal(cred.username, 'admin');
    assert.equal(cred.secret, 'P@ssw0rd!');
    assert.equal(cred.secret_enc, undefined);
  });

  it('remove() deletes credential', async () => {
    const id2 = await CredentialStore.store({ engagementId: eid, type: 'hash', secret: 'abc123' });
    assert.equal(CredentialStore.remove(id2), true);
    const cred = await CredentialStore.retrieve(id2);
    assert.equal(cred, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Store: SessionStore
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: SessionStore', () => {
  const Engagement   = require('./db/models/engagement');
  const SessionStore = require('./store/session-store');
  let eid, sid;

  before(() => { eid = Engagement.create({ name: 'Session Test Op' }); });

  it('create() returns an ID', () => {
    sid = SessionStore.create({ engagementId: eid, module: 'recon', transport: 'http' });
    assert.ok(sid);
  });

  it('findById() retrieves session', () => {
    const s = SessionStore.findById(sid);
    assert.equal(s.module, 'recon');
    assert.equal(s.status, 'active');
  });

  it('listActive() returns active sessions', () => {
    const all = SessionStore.listActive();
    assert.ok(all.some(s => s.id === sid));
  });

  it('heartbeat() updates last_seen', () => {
    const ok = SessionStore.heartbeat(sid);
    assert.equal(ok, true);
  });

  it('setInactive() changes status', () => {
    SessionStore.setInactive(sid);
    assert.equal(SessionStore.findById(sid).status, 'inactive');
  });

  it('remove() deletes session', () => {
    const sid2 = SessionStore.create({ engagementId: eid, module: 'c2' });
    SessionStore.remove(sid2);
    assert.equal(SessionStore.findById(sid2), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Graph: TargetGraph
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: TargetGraph', () => {
  const Engagement  = require('./db/models/engagement');
  const TargetGraph = require('./graph/target-graph');
  let eid;

  before(() => { eid = Engagement.create({ name: 'Graph Test Op' }); });

  it('addNode() and toD3() work', () => {
    TargetGraph.addNode({ id: 'n1', engagementId: eid, type: 'host', value: '10.0.0.1', label: 'DC' });
    TargetGraph.addNode({ id: 'n2', engagementId: eid, type: 'host', value: '10.0.0.2', label: 'WS' });
    TargetGraph.addEdge({ sourceId: 'n1', targetId: 'n2', relation: 'connects' });
    const g = TargetGraph.toD3(eid);
    assert.equal(g.nodes.length, 2);
    assert.equal(g.links.length, 1);
    assert.equal(g.links[0].relation, 'connects');
  });

  it('findPaths() finds a direct path', () => {
    const paths = TargetGraph.findPaths('n1', 'n2');
    assert.ok(paths.length >= 1);
    assert.ok(paths[0].includes('n1') && paths[0].includes('n2'));
  });

  it('getSubgraph() returns neighbourhood', () => {
    TargetGraph.addNode({ id: 'n3', engagementId: eid, type: 'service', value: 'SMB', label: 'SMB' });
    TargetGraph.addEdge({ sourceId: 'n2', targetId: 'n3', relation: 'runs' });
    const sub = TargetGraph.getSubgraph('n1', 2);
    assert.ok(sub.nodes.length >= 2);
  });

  it('removeNode() deletes node and its edges', () => {
    TargetGraph.addNode({ id: 'tmp', engagementId: eid, type: 'host', value: 'tmp' });
    TargetGraph.addEdge({ sourceId: 'n1', targetId: 'tmp', relation: 'test' });
    TargetGraph.removeNode('tmp');
    const g = TargetGraph.toD3(eid);
    assert.ok(!g.nodes.some(n => n.id === 'tmp'));
    assert.ok(!g.links.some(l => l.target === 'tmp'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Graph: ADGraph
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: ADGraph', () => {
  const Engagement = require('./db/models/engagement');
  const ADGraph    = require('./graph/ad-graph');
  let eid;

  before(() => { eid = Engagement.create({ name: 'AD Test Op' }); });

  it('upsertNode() creates AD nodes', () => {
    ADGraph.upsertNode({ id: 'u1', engagementId: eid, name: 'jdoe', type: 'user', domain: 'CORP', kerberoastable: true });
    ADGraph.upsertNode({ id: 'g1', engagementId: eid, name: 'Domain Admins', type: 'domain-admin', domain: 'CORP', adminCount: true });
    const g = ADGraph.toD3(eid);
    assert.equal(g.nodes.length, 2);
  });

  it('addEdge() creates AD edges', () => {
    ADGraph.addEdge({ engagementId: eid, sourceId: 'u1', targetId: 'g1', relation: 'MemberOf' });
    const g = ADGraph.toD3(eid);
    assert.equal(g.links.length, 1);
    assert.equal(g.links[0].relation, 'MemberOf');
  });

  it('findKerberoastable() returns kerberoastable accounts', () => {
    const targets = ADGraph.findKerberoastable(eid);
    assert.ok(targets.some(t => t.id === 'u1'));
  });

  it('findDomainAdmins() returns DA accounts', () => {
    const das = ADGraph.findDomainAdmins(eid);
    assert.ok(das.some(d => d.id === 'g1'));
  });

  it('findDomainAdminPaths() finds path to DA', () => {
    const paths = ADGraph.findDomainAdminPaths(eid, 'u1');
    assert.ok(paths.length >= 1);
    assert.ok(paths[0].includes('u1') && paths[0].includes('g1'));
  });

  it('ingest() processes BloodHound-style JSON', () => {
    const eid2 = require('./db/models/engagement').create({ name: 'BH Ingest' });
    const stats = ADGraph.ingest(eid2, {
      users: [{ ObjectIdentifier: 'bh-u1', Properties: { name: 'alice', domain: 'CORP', hasspn: true } }],
      groups: [{ ObjectIdentifier: 'bh-g1', Properties: { name: 'Domain Admins', domain: 'CORP', admincount: true } }],
    });
    assert.equal(stats.users, 1);
    assert.equal(stats.groups, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Audit: AuditLog
// ═══════════════════════════════════════════════════════════════════════════════

describe('Core: AuditLog', () => {
  const AuditLog = require('./audit/audit-log');

  it('append() writes an entry and returns a hash', () => {
    const h = AuditLog.append('test:action', 'subject-1', 'detail string');
    assert.ok(typeof h === 'string' && h.length === 64); // sha256 hex
  });

  it('tail() returns recent entries', () => {
    AuditLog.append('test:another', 'subject-2', 'more detail');
    const rows = AuditLog.tail(10);
    assert.ok(rows.length >= 2);
    assert.ok(rows.every(r => r.hash && r.ts && r.action));
  });

  it('verify() returns valid:true for intact chain', () => {
    const result = AuditLog.verify();
    assert.equal(result.valid, true);
    assert.ok(result.checked >= 2);
  });

  it('verify() detects tampering of subject and engagement scope', () => {
    const db = require('./db/database').get();
    const h = AuditLog.append('test:scoped', 'subject-a', 'detail', 'eng-a');
    const row = db.prepare('SELECT * FROM audit_log WHERE hash=?').get(h);
    db.exec('DROP TRIGGER audit_log_no_update');
    try {
      db.prepare('UPDATE audit_log SET subject=? WHERE id=?').run('subject-b', row.id);
      assert.equal(AuditLog.verify().valid, false);
      db.prepare('UPDATE audit_log SET subject=? WHERE id=?').run('subject-a', row.id);
    } finally {
      db.exec(`CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`);
    }
    assert.equal(AuditLog.verify().valid, true);
  });

  it('audit log is append-only at the database layer', () => {
    const rows = AuditLog.tail(1);
    assert.equal(rows.length, 1);
    assert.throws(() => {
      require('./db/database').get().prepare('UPDATE audit_log SET action=? WHERE id=?').run('tampered', rows[0].id);
    }, /append-only/);
    assert.throws(() => {
      require('./db/database').get().prepare('DELETE FROM audit_log WHERE id=?').run(rows[0].id);
    }, /append-only/);
    assert.equal(AuditLog.verify().valid, true);
  });

  it('range() returns entries within time range', () => {
    const now  = new Date().toISOString();
    const past = new Date(Date.now() - 60000).toISOString();
    const rows = AuditLog.range(past, now);
    assert.ok(rows.length >= 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lifecycle: module engagement integrity
// ═══════════════════════════════════════════════════════════════════════════════
describe('Core: module engagement lifecycle integrity', () => {
  it('rejects module rows for nonexistent engagements and cascades deletion', () => {
    const db = require('./db/database').get();
    const Integrity = require('./db/engagement-integrity');
    db.exec(`CREATE TABLE IF NOT EXISTS test_module_rows (id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL)`);
    Integrity.install(db, ['test_module_rows']);
    assert.throws(() => db.prepare('INSERT INTO test_module_rows(id,engagement_id) VALUES(?,?)').run('bad','missing'), /invalid engagement_id/);
    db.prepare("INSERT OR IGNORE INTO engagements(id,name) VALUES(?,?)").run('lifecycle-e1','Lifecycle');
    db.prepare('INSERT INTO test_module_rows(id,engagement_id) VALUES(?,?)').run('good','lifecycle-e1');
    db.prepare('DELETE FROM engagements WHERE id=?').run('lifecycle-e1');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM test_module_rows WHERE id=?').get('good').n, 0);
  });
});
