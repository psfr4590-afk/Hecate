'use strict';

/**
 * HECATE — Phase 5 C2 Test Suite
 * Tests all pure C2 components. No network, no DB, no actual implants.
 *
 * Run: node --test modules/c2/c2.test.js
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const c2Store = require('./storage/c2-store');
const testDb = new DatabaseSync(':memory:');
testDb.exec('CREATE TABLE engagements (id TEXT PRIMARY KEY);');
c2Store.init(testDb, {});

// ═════════════════════════════════════════════════════════════════════════════
// PROTOCOL: Encrypt / Decrypt
// ═════════════════════════════════════════════════════════════════════════════

describe('Protocol: crypto', () => {
  const proto = require('./implant/protocol');

  it('generateKey() returns a 32-byte Buffer', () => {
    const k = proto.generateKey();
    assert.ok(Buffer.isBuffer(k));
    assert.equal(k.length, 32);
  });

  it('encrypt() returns a base64 string', () => {
    const key  = proto.generateKey();
    const blob = proto.encrypt({ type: 'checkin' }, key);
    assert.equal(typeof blob, 'string');
    assert.ok(blob.length > 0);
    // Must be valid base64
    assert.doesNotThrow(() => Buffer.from(blob, 'base64'));
  });

  it('decrypt() round-trips correctly', () => {
    const key     = proto.generateKey();
    const payload = { type: 'checkin', ts: '2026-09-12T00:00:00.000Z', info: { os: 'windows' } };
    const blob    = proto.encrypt(payload, key);
    const decoded = proto.decrypt(blob, key);
    assert.deepEqual(decoded, payload);
  });

  it('decrypt() throws on wrong key', () => {
    const k1   = proto.generateKey();
    const k2   = proto.generateKey();
    const blob = proto.encrypt({ data: 'secret' }, k1);
    assert.throws(() => proto.decrypt(blob, k2));
  });

  it('decrypt() throws on tampered ciphertext', () => {
    const key  = proto.generateKey();
    const blob = proto.encrypt({ data: 'ok' }, key);
    // Flip a byte in the middle
    const buf  = Buffer.from(blob, 'base64');
    buf[buf.length - 5] ^= 0xFF;
    assert.throws(() => proto.decrypt(buf.toString('base64'), key));
  });

  it('each encrypt() produces unique ciphertext (IV randomness)', () => {
    const key  = proto.generateKey();
    const msg  = { type: 'ping' };
    const b1   = proto.encrypt(msg, key);
    const b2   = proto.encrypt(msg, key);
    assert.notEqual(b1, b2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PROTOCOL: Message builders + validators
// ═════════════════════════════════════════════════════════════════════════════

describe('Protocol: messages', () => {
  const proto = require('./implant/protocol');

  it('buildCheckin() has required fields', () => {
    const msg = proto.buildCheckin({ os: 'windows', hostname: 'CORP-001' });
    assert.equal(msg.type, 'checkin');
    assert.ok(msg.ts);
    assert.ok(msg.info.hostname);
  });

  it('buildResult() has required fields', () => {
    const msg = proto.buildResult([{ taskId: 'abc', output: 'whoami output', exitCode: 0 }]);
    assert.equal(msg.type, 'result');
    assert.equal(msg.results.length, 1);
    assert.equal(msg.results[0].taskId, 'abc');
  });

  it('buildTasklist() serialises correctly', () => {
    const tasks = [{ id: 't1', type: 'shell', payload: { cmd: 'whoami' } }];
    const msg   = proto.buildTasklist(tasks, 30, 20);
    assert.equal(msg.type, 'tasklist');
    assert.equal(msg.sleep, 30);
    assert.equal(msg.tasks.length, 1);
  });

  it('buildDie() has correct type', () => {
    const msg = proto.buildDie('operator');
    assert.equal(msg.type, 'die');
    assert.equal(msg.reason, 'operator');
  });

  it('validateCheckin() passes valid checkin', () => {
    const msg = proto.buildCheckin({ os: 'linux' });
    assert.equal(proto.validateCheckin(msg), true);
  });

  it('validateCheckin() rejects non-checkin message', () => {
    assert.equal(proto.validateCheckin({ type: 'result', results: [] }), false);
    assert.equal(proto.validateCheckin(null), false);
  });

  it('validateResult() passes valid result', () => {
    const msg = proto.buildResult([{ taskId: 'x', output: '' }]);
    assert.equal(proto.validateResult(msg), true);
  });

  it('validateResult() rejects checkin message', () => {
    assert.equal(proto.validateResult({ type: 'checkin', info: {} }), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// IMPLANT: Profile
// ═════════════════════════════════════════════════════════════════════════════

describe('Implant: profile', () => {
  const prof = require('./implant/profile');

  before(() => prof.clear());

  it('create() returns a profile with id', () => {
    const p = prof.create({ sleepSec: 60 });
    assert.ok(p.id);
    assert.equal(p.sleepSec, 60);
  });

  it('create() fills DEFAULT_PROFILE values', () => {
    const p = prof.create({});
    assert.equal(p.jitterPct, prof.DEFAULT_PROFILE.jitterPct);
    assert.equal(p.transport, 'https');
  });

  it('get() retrieves by id', () => {
    const p  = prof.create({ sleepSec: 45 });
    const p2 = prof.get(p.id);
    assert.equal(p2.sleepSec, 45);
  });

  it('validate() passes valid profile', () => {
    assert.doesNotThrow(() => prof.validate(prof.DEFAULT_PROFILE));
  });

  it('validate() throws on sleepSec < 1', () => {
    assert.throws(() => prof.validate({ ...prof.DEFAULT_PROFILE, sleepSec: 0 }), /sleepSec/);
  });

  it('validate() throws on jitterPct > 100', () => {
    assert.throws(() => prof.validate({ ...prof.DEFAULT_PROFILE, jitterPct: 150 }), /jitterPct/);
  });

  it('validate() throws on unknown transport', () => {
    assert.throws(() => prof.validate({ ...prof.DEFAULT_PROFILE, transport: 'tcp' }), /transport/);
  });

  it('validate() throws on invalid killDate', () => {
    assert.throws(() => prof.validate({ ...prof.DEFAULT_PROFILE, killDate: 'not-a-date' }), /killDate/);
  });

  it('sleepRange() returns min/max/nominal correctly', () => {
    const r = prof.sleepRange(60, 20);
    assert.equal(r.nominalMs, 60000);
    assert.equal(r.minMs, 48000);   // 60000 - 20%
    assert.equal(r.maxMs, 72000);   // 60000 + 20%
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// IMPLANT: Task Queue
// ═════════════════════════════════════════════════════════════════════════════

describe('Implant: task-queue', () => {
  const tq = require('./implant/task-queue');
  const { TASK_TYPES } = require('./implant/protocol');

  before(() => {
    tq.clearAll();
    testDb.prepare("INSERT OR IGNORE INTO engagements(id) VALUES(?)").run('test-engagement');
    for (const id of ['imp-1','imp-2','imp-3','imp-4','imp-5','imp-6','agent-1','agent-2','agent-3','agent-4','agent-5','agent-6']) {
      testDb.prepare("INSERT OR IGNORE INTO c2_implants(id,engagement_id,key_enc) VALUES(?,?,?)").run(id, 'test-engagement', '');
    }
  });

  it('enqueue() adds a task', () => {
    tq.enqueue('imp-1', TASK_TYPES.SHELL, { cmd: 'whoami' });
    assert.equal(tq.size('imp-1'), 1);
  });

  it('claim() removes and returns tasks', () => {
    tq.clearAll();
    tq.enqueue('imp-1', TASK_TYPES.SHELL, { cmd: 'id' });
    tq.enqueue('imp-1', TASK_TYPES.SYSINFO, {});
    const claimed = tq.claim('imp-1', 10);
    assert.equal(claimed.length, 2);
    assert.equal(tq.size('imp-1'), 0);
  });

  it('claim() respects max limit', () => {
    tq.clearAll();
    for (let i = 0; i < 5; i++) tq.enqueue('imp-2', TASK_TYPES.SHELL, { cmd: `cmd${i}` });
    const claimed = tq.claim('imp-2', 3);
    assert.equal(claimed.length, 3);
    assert.equal(tq.size('imp-2'), 2);
  });

  it('urgent task jumps to front of queue', () => {
    tq.clearAll();
    tq.enqueue('imp-3', TASK_TYPES.SHELL, { cmd: 'whoami' });
    tq.enqueue('imp-3', TASK_TYPES.DIE, {}, true);
    const first = tq.claim('imp-3', 1)[0];
    assert.equal(first.type, TASK_TYPES.DIE);
  });

  it('DIE type auto-prepends (HIGH_PRIORITY)', () => {
    tq.clearAll();
    tq.enqueue('imp-4', TASK_TYPES.SHELL, { cmd: 'cmd' });
    tq.enqueue('imp-4', TASK_TYPES.DIE,   { reason: 'test' });
    const first = tq.peek('imp-4')[0];
    assert.equal(first.type, TASK_TYPES.DIE);
  });

  it('cancel() removes a queued task', () => {
    tq.clearAll();
    const task = tq.enqueue('imp-5', TASK_TYPES.SHELL, { cmd: 'ls' });
    assert.equal(tq.cancel('imp-5', task.id), true);
    assert.equal(tq.size('imp-5'), 0);
  });

  it('cancel() returns false for claimed/missing task', () => {
    assert.equal(tq.cancel('imp-none', 'bad-id'), false);
  });

  it('claim() marks tasks as claimed', () => {
    tq.clearAll();
    tq.enqueue('imp-6', TASK_TYPES.SYSINFO, {});
    const [t] = tq.claim('imp-6', 1);
    assert.equal(t.status, 'claimed');
    assert.ok(t.claimedAt);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TASKS: Task Builder
// ═════════════════════════════════════════════════════════════════════════════

describe('Tasks: task-builder', () => {
  const builder = require('./tasks/task-builder');
  const tq      = require('./implant/task-queue');
  const { TASK_TYPES } = require('./implant/protocol');

  before(() => {
    tq.clearAll();
    testDb.prepare("INSERT OR IGNORE INTO engagements(id) VALUES(?)").run('test-engagement');
    for (const id of ['imp-1','imp-2','imp-3','imp-4','imp-5','imp-6','agent-1','agent-2','agent-3','agent-4','agent-5','agent-6']) {
      testDb.prepare("INSERT OR IGNORE INTO c2_implants(id,engagement_id,key_enc) VALUES(?,?,?)").run(id, 'test-engagement', '');
    }
  });

  it('shell() enqueues a shell task', () => {
    const t = builder.shell('agent-1', 'whoami /all');
    assert.equal(t.type, TASK_TYPES.SHELL);
    assert.equal(t.payload.cmd, 'whoami /all');
  });

  it('shell() throws on empty cmd', () => {
    assert.throws(() => builder.shell('agent-1', ''), /cmd required/);
  });

  it('sysinfo() enqueues sysinfo task', () => {
    const t = builder.sysinfo('agent-1');
    assert.equal(t.type, TASK_TYPES.SYSINFO);
  });

  it('upload() enqueues upload task with path', () => {
    const t = builder.upload('agent-1', 'C:\\Windows\\SAM');
    assert.equal(t.type, TASK_TYPES.UPLOAD);
    assert.equal(t.payload.path, 'C:\\Windows\\SAM');
  });

  it('upload() throws on missing path', () => {
    assert.throws(() => builder.upload('agent-1', null), /remotePath required/);
  });

  it('download() enqueues download task', () => {
    const t = builder.download('agent-1', '/tmp/payload.bin', Buffer.from('MZ').toString('base64'));
    assert.equal(t.type, TASK_TYPES.DOWNLOAD);
    assert.ok(t.payload.content);
  });

  it('sleep() enqueues as high priority', () => {
    tq.clearAll();
    builder.shell('agent-2', 'cmd');
    builder.sleep('agent-2', 120, 10);
    const first = tq.peek('agent-2')[0];
    assert.equal(first.type, TASK_TYPES.SLEEP);
  });

  it('sleep() throws on sleepSec < 1', () => {
    assert.throws(() => builder.sleep('agent-1', 0), /sleepSec must be/);
  });

  it('die() enqueues as high priority with reason', () => {
    tq.clearAll();
    builder.shell('agent-3', 'cmd');
    builder.die('agent-3', 'test-kill');
    const first = tq.peek('agent-3')[0];
    assert.equal(first.type, TASK_TYPES.DIE);
    assert.equal(first.payload.reason, 'test-kill');
  });

  it('parseResult() enriches sysinfo output', () => {
    const task   = { id: 't1', type: TASK_TYPES.SYSINFO, implantId: 'a' };
    const raw    = { output: JSON.stringify({ hostname: 'PC1' }), exitCode: 0 };
    const result = builder.parseResult(task, raw);
    assert.equal(result.structured.hostname, 'PC1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BEACON: Beacon Store
// ═════════════════════════════════════════════════════════════════════════════

describe('Beacon: beacon-store', () => {
  const bs = require('./beacon/beacon-store');

  before(() => { bs.clear(); bs.stopCleanup?.(); });

  it('checkin() creates a new beacon', () => {
    const b = bs.checkin('imp-A', 'eng-1', { os: 'windows', hostname: 'W10-001' }, '10.0.0.1', 30, 20);
    assert.equal(b.state, 'active');
    assert.equal(b.checkinCount, 1);
  });

  it('checkin() updates existing beacon', () => {
    bs.checkin('imp-A', 'eng-1', { os: 'windows' }, '10.0.0.1', 30, 20);
    const b = bs.checkin('imp-A', 'eng-1', { os: 'windows' }, '10.0.0.2', 30, 20);
    assert.equal(b.checkinCount, 3);
    assert.equal(b.ip, '10.0.0.2');
  });

  it('get() retrieves beacon by implantId', () => {
    const b = bs.get('imp-A');
    assert.ok(b);
    assert.equal(b.implantId, 'imp-A');
  });

  it('get() returns null for unknown implant', () => {
    assert.equal(bs.get('unknown'), null);
  });

  it('list() filters by engagementId', () => {
    bs.checkin('imp-B', 'eng-2', {}, '1.1.1.1', 30, 20);
    const forEng1 = bs.list({ engagementId: 'eng-1' });
    assert.ok(forEng1.every(b => b.engagementId === 'eng-1'));
  });

  it('kill() sets state to killed', () => {
    bs.kill('imp-A');
    const b = bs.get('imp-A');
    assert.equal(b.state, 'killed');
  });

  it('sweepStale() marks overdue beacons stale', () => {
    bs.clear();
    // Create a beacon with nextExpected in the past
    const b = bs.checkin('imp-stale', 'eng-1', {}, '1.2.3.4', 30, 20);
    b.nextExpected = Date.now() - 1000; // force overdue
    bs.sweepStale();
    assert.ok(['stale', 'dead'].includes(b.state));
  });

  it('stats() returns total and byState', () => {
    const s = bs.stats();
    assert.ok(typeof s.total === 'number');
    assert.ok(s.byState);
  });
});
