'use strict';
const crypto = require('crypto');
const fs     = require('fs');

let _key = null;
const ALG = 'aes-256-gcm';

async function load(keyPath) {
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw new Error(`Key must be 32 bytes, got ${key.length}`);
  _key = key;
}

async function encrypt(plaintext) {
  if (!_key) throw new Error('KeyManager: key not loaded');
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, _key, iv);
  const enc    = Buffer.concat([cipher.update(Buffer.from(String(plaintext), 'utf8')), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

async function decrypt(ciphertext) {
  if (!_key) throw new Error('KeyManager: key not loaded');
  const buf = Buffer.from(ciphertext, 'base64');
  const iv  = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const enc = buf.slice(28);
  const dec = crypto.createDecipheriv(ALG, _key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

function clear()    { _key = null; }
function isLoaded() { return _key !== null; }

module.exports = { load, encrypt, decrypt, clear, isLoaded };
