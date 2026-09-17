'use strict';

const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

function isPrivateIp(address) {
  const normalized = address.toLowerCase();
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a >= 224) ||
      (a === 100 && b >= 64 && b <= 127);
  }

  if (!net.isIPv6(address)) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIp(address.slice(7));
  return false;
}

async function resolveAndValidate(hostname, { allowPrivate = false } = {}) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error('SSRF guard: empty hostname');
  if (BLOCKED_HOSTS.has(host)) throw new Error(`SSRF guard: blocked hostname ${host}`);

  if (net.isIP(host)) {
    if (!allowPrivate && isPrivateIp(host)) throw new Error('SSRF guard: private or special-use address denied');
    return [host];
  }

  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length) throw new Error('SSRF guard: hostname did not resolve');
  if (!allowPrivate && records.some(r => isPrivateIp(r.address))) {
    throw new Error('SSRF guard: hostname resolves to private or special-use address');
  }
  return records.map(r => r.address);
}

async function validateUrl(value, options = {}) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('SSRF guard: invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('SSRF guard: only HTTP(S) URLs are permitted');
  }
  await resolveAndValidate(parsed.hostname, options);
  return parsed;
}

module.exports = { isPrivateIp, resolveAndValidate, validateUrl };
