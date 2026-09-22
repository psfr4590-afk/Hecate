'use strict';

/**
 * Clean-install startup smoke test.
 * Exercises the real CLI entrypoint, bootstrap, database, key loading,
 * module initialisation, HTTP bind, health endpoint, and graceful shutdown.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`HECATE exited before health check (code ${child.exitCode})`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for HECATE health endpoint');
}

async function main() {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hecate-start-smoke-'));
  const keyPath = path.join(runtimeDir, 'operator.key');
  const dbPath = path.join(runtimeDir, 'hecate.db');
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 });

  const port = await freePort();
  const env = {
    ...process.env,
    HECATE_API_TOKEN: token,
    HECATE_KEY_PATH: keyPath,
    HECATE_HOST: '127.0.0.1',
    HECATE_PORT: String(port),
  };

  const child = spawn(process.execPath, [
    '--experimental-sqlite',
    path.join(ROOT, 'cli', 'index.js'),
    'start',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--db', dbPath,
    '--key', keyPath,
  ], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });

  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForHealth(base, child);

    const response = await fetch(`${base}/api/v1/status`, {
      headers: { 'X-Hecate-Token': token },
    });
    assert.equal(response.status, 200, `status endpoint failed: ${await response.text()}`);
    const status = await response.json();
    assert.equal(status.platform, 'HECATE');
    assert.ok(Array.isArray(status.modules));
    assert.equal(status.modules.length, 7);

    child.kill('SIGTERM');
    const exitCode = await new Promise(resolve => child.once('exit', code => resolve(code)));
    assert.equal(exitCode, 0, `HECATE did not shut down cleanly. stdout=${stdout} stderr=${stderr}`);
    assert.ok(fs.existsSync(dbPath), 'startup should create the SQLite database');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }

  process.stdout.write('HECATE clean-start smoke test passed\\n');
}

main().catch(err => {
  process.stderr.write(`HECATE clean-start smoke test failed: ${err.stack || err.message}\\n`);
  process.exitCode = 1;
});
