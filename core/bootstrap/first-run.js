'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

function localStateDir() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.resolve(home, '.hecate');
}

function secureWrite(filePath, bytes) {
  fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function ensureOperatorCredentials(options = {}) {
  const stateDir = path.resolve(options.stateDir || localStateDir());
  fs.mkdirSync(stateDir, { recursive: true });

  const keyPath = path.resolve(options.keyPath || path.join(stateDir, 'operator.key'));
  const tokenPath = path.resolve(options.tokenPath || path.join(stateDir, 'operator.token'));

  if (!fs.existsSync(keyPath)) {
    secureWrite(keyPath, crypto.randomBytes(32));
  }
  if (fs.statSync(keyPath).size !== 32) {
    throw new Error(`Operator key must be exactly 32 bytes: ${keyPath}`);
  }

  if (!process.env.HECATE_API_TOKEN) {
    if (fs.existsSync(tokenPath)) {
      const token = fs.readFileSync(tokenPath, 'utf8').trim();
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
        throw new Error(`Invalid operator token stored at ${tokenPath}`);
      }
      process.env.HECATE_API_TOKEN = token;
    } else {
      const token = crypto.randomBytes(32).toString('base64url');
      secureWrite(tokenPath, Buffer.from(token + '\n', 'utf8'));
      process.env.HECATE_API_TOKEN = token;
    }
  }

  process.env.HECATE_KEY_PATH = keyPath;
  return { stateDir, keyPath, tokenPath, firstRun: !fs.existsSync(path.join(stateDir, '.initialized')) };
}

function markInitialized(stateDir) {
  const marker = path.join(stateDir, '.initialized');
  if (!fs.existsSync(marker)) secureWrite(marker, Buffer.from(new Date().toISOString() + '\n', 'utf8'));
}

module.exports = { localStateDir, ensureOperatorCredentials, markInitialized };
