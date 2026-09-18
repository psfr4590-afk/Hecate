'use strict';

/**
 * HECATE — End-to-end smoke test against a disposable OWASP Juice Shop.
 *
 * This is intentionally separate from the unit/regression suite because it
 * requires Docker and performs real HTTP requests against a disposable local
 * target.
 *
 * Run:
 *   npm run test:e2e:juice-shop
 *
 * The test creates:
 *   Docker Juice Shop -> HECATE engagement -> target -> Recon job
 *   -> Webapp scan -> persisted results -> audit verification
 *
 * No credentials, captured evidence, databases, or runtime artifacts are
 * written into the repository.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const JUICE_IMAGE = process.env.HECATE_E2E_JUICE_IMAGE || 'bkimminich/juice-shop';
const TIMEOUT_MS = Number(process.env.HECATE_E2E_TIMEOUT_MS || 120_000);

let runtimeDir;
let containerName;
let hecate;
let juicePort;
let hecatePort;
let keyPath;

function log(message, meta = {}) {
  process.stdout.write(`[HECATE E2E] ${message}${Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''}\n`);
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true });
  return result.status === 0;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check, description, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${pathname} -> HTTP ${response.status}: ${body?.error?.message || text}`);
  }
  return { response, body };
}

async function waitForJob(base, token, id) {
  return waitFor(async () => {
    const { body } = await request(base, `/api/v1/recon/jobs/${encodeURIComponent(id)}`, {
      headers: { 'X-Hecate-Token': token },
    });
    const job = body.job;
    if (job.status === 'complete' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') {
      return job;
    }
    return false;
  }, `Recon job ${id} to finish`);
}

async function waitForScan(base, token, id) {
  return waitFor(async () => {
    const { body } = await request(base, `/api/v1/webapp/scans/${encodeURIComponent(id)}`, {
      headers: { 'X-Hecate-Token': token },
    });
    const scan = body.scan;
    if (scan.status === 'complete' || scan.status === 'failed' || scan.status === 'cancelled' || scan.status === 'interrupted') {
      return scan;
    }
    return false;
  }, `Webapp scan ${id} to finish`);
}

async function startProcess() {
  const token = crypto.randomBytes(32).toString('hex');
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hecate-e2e-'));
  keyPath = path.join(runtimeDir, 'operator.key');
  fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 });

  hecatePort = await freePort();
  juicePort = await freePort();

  containerName = `hecate-e2e-juice-shop-${process.pid}`;

  log('Starting disposable Juice Shop', { image: JUICE_IMAGE, port: juicePort });
  const docker = spawnSync('docker', [
    'run', '-d',
    '--name', containerName,
    '-p', `127.0.0.1:${juicePort}:3000`,
    JUICE_IMAGE,
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true });

  if (docker.status !== 0) {
    throw new Error(`Docker could not start Juice Shop: ${docker.stderr || docker.stdout}`);
  }

  const juiceBase = `http://127.0.0.1:${juicePort}`;
  await waitFor(async () => {
    const response = await fetch(`${juiceBase}/`, { redirect: 'manual' });
    return response.status >= 200 && response.status < 500;
  }, 'Juice Shop HTTP service');

  log('Juice Shop ready', { url: juiceBase });

  const dbPath = path.join(runtimeDir, 'hecate.db');
  const env = {
    ...process.env,
    HECATE_API_TOKEN: token,
    HECATE_KEY_PATH: keyPath,
    HECATE_HOST: '127.0.0.1',
    HECATE_PORT: String(hecatePort),
  };

  log('Starting isolated HECATE runtime', { port: hecatePort });
  hecate = spawn(process.execPath, [
    '--experimental-sqlite',
    path.join(ROOT, 'cli', 'index.js'),
    'start',
    '--host', '127.0.0.1',
    '--port', String(hecatePort),
    '--db', dbPath,
    '--key', keyPath,
  ], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  hecate.stdout.on('data', chunk => {
    const text = String(chunk).trim();
    if (text) process.stdout.write(`[HECATE] ${text}\n`);
  });
  hecate.stderr.on('data', chunk => {
    const text = String(chunk).trim();
    if (text) process.stderr.write(`[HECATE STDERR] ${text}\n`);
  });

  const hecateBase = `http://127.0.0.1:${hecatePort}`;
  await waitFor(async () => {
    const response = await fetch(`${hecateBase}/health`);
    return response.ok;
  }, 'HECATE health endpoint');

  log('HECATE ready', { url: hecateBase });
  return { token, juiceBase, hecateBase };
}

async function run() {
  if (!commandExists('docker')) {
    throw new Error('Docker CLI is required for the Juice Shop E2E smoke test.');
  }

  const { token, juiceBase, hecateBase } = await startProcess();
  const auth = { 'X-Hecate-Token': token };

  log('Creating engagement');
  const engagementResponse = await request(hecateBase, '/api/v1/engagements', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      name: 'E2E Smoke — OWASP Juice Shop',
      description: 'Disposable local OWASP Juice Shop end-to-end smoke assessment.',
      scope: `In scope: ${juiceBase}. Out of scope: all other hosts and local services.`,
      status: 'active',
    }),
  });
  const engagementId = engagementResponse.body.engagement.id;
  assert.ok(engagementId, 'engagement ID should be returned');

  log('Registering target');
  const targetResponse = await request(
    hecateBase,
    `/api/v1/targets/engagement/${encodeURIComponent(engagementId)}`,
    {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        type: 'webapp',
        value: juiceBase,
        label: 'Juice Shop E2E',
        metadata: JSON.stringify({ source: 'e2e-smoke', disposable: true }),
      }),
    }
  );
  const targetId = targetResponse.body.target.id;
  assert.ok(targetId, 'target ID should be returned');

  log('Starting Recon');
  const reconResponse = await request(hecateBase, '/api/v1/recon/jobs', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      engagementId,
      targetId,
      seedUrls: [`${juiceBase}/`],
      config: {
        allowPrivateTargets: true,
        concurrency: 2,
        maxDepth: 1,
        maxPages: 20,
        ratePerSec: 20,
        burst: 4,
        timeoutMs: 5000,
        maxRetries: 0,
        applyJitter: false,
      },
    }),
  });
  const reconId = reconResponse.body.jobId;
  assert.ok(reconId, 'Recon job ID should be returned');

  const reconJob = await waitForJob(hecateBase, token, reconId);
  assert.equal(reconJob.status, 'complete', `Recon should complete, got ${reconJob.status}`);

  const reconStats = await request(
    hecateBase,
    `/api/v1/recon/jobs/${encodeURIComponent(reconId)}/stats`,
    { headers: auth }
  );
  assert.ok(reconStats.body.pages > 0, 'Recon should persist at least one crawled page');

  const reconPages = await request(
    hecateBase,
    `/api/v1/recon/jobs/${encodeURIComponent(reconId)}/pages?limit=20`,
    { headers: auth }
  );
  assert.ok(reconPages.body.total > 0, 'Recon should expose persisted pages');

  log('Recon complete', {
    jobId: reconId,
    pages: reconStats.body.pages,
    forms: reconStats.body.forms,
    secrets: reconStats.body.secrets,
  });

  log('Starting Web Application scan');
  const scanResponse = await request(hecateBase, '/api/v1/webapp/scans', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      engagementId,
      targetId,
      targetUrl: `${juiceBase}/`,
      config: {
        allowPrivateTargets: true,
        concurrency: 4,
        ratePerSec: 25,
        timeoutMs: 5000,
        maxBodyBytes: 1024 * 1024,
        dirFuzz: true,
        paramFuzz: false,
        headerFuzz: false,
      },
    }),
  });
  const scanId = scanResponse.body.scanId;
  assert.ok(scanId, 'webapp scan ID should be returned');

  const scan = await waitForScan(hecateBase, token, scanId);
  assert.equal(scan.status, 'complete', `Webapp scan should complete, got ${scan.status}`);

  const scanStats = await request(
    hecateBase,
    `/api/v1/webapp/scans/${encodeURIComponent(scanId)}/stats`,
    { headers: auth }
  );
  assert.ok(scanStats.body.requests > 0, 'Webapp scan should persist HTTP requests');

  const findings = await request(
    hecateBase,
    `/api/v1/webapp/scans/${encodeURIComponent(scanId)}/findings`,
    { headers: auth }
  );
  assert.ok(findings.body.total > 0, 'Juice Shop should produce at least one scanner finding');

  log('Webapp scan complete', {
    scanId,
    requests: scanStats.body.requests,
    hits: scanStats.body.hits,
    findings: findings.body.total,
  });

  const audit = await request(hecateBase, '/api/v1/audit/verify', { headers: auth });
  assert.equal(audit.body.valid, true, 'audit chain should remain valid after E2E workflow');

  log('E2E SMOKE PASS', {
    engagementId,
    targetId,
    reconId,
    scanId,
    reconPages: reconStats.body.pages,
    webappRequests: scanStats.body.requests,
    webappFindings: findings.body.total,
  });
}

async function cleanup() {
  if (hecate) {
    try {
      if (hecate.exitCode === null) {
        hecate.kill('SIGTERM');
        await waitFor(() => hecate.exitCode !== null, 'HECATE shutdown', 5000).catch(() => {
          if (hecate.exitCode === null) hecate.kill();
        });
      }
    } catch {}
    hecate = null;
  }

  if (containerName) {
    spawnSync('docker', ['rm', '-f', containerName], {
      cwd: ROOT,
      stdio: 'ignore',
      windowsHide: true,
    });
    containerName = null;
  }

  if (runtimeDir) {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
    runtimeDir = null;
  }
}

run()
  .catch(err => {
    process.stderr.write(`[HECATE E2E] FAIL: ${err.stack || err.message}\n`);
    process.exitCode = 1;
  })
  .finally(cleanup);
