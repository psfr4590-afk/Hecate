'use strict';

/**
 * HECATE Webapp — Vulnerability Check Library
 * Each check is a pure function:
 *   check(req, res) → { vulnerable: bool, severity, confidence, evidence, detail }
 *
 * Checks operate on completed request-response pairs — the scanner
 * calls the check after fetching. No I/O in check functions.
 */

// ── Severity constants ────────────────────────────────────────────────────────

const SEV = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFO: 'info' };

// ── Helper ────────────────────────────────────────────────────────────────────

function hit(severity, confidence, detail, evidence = null) {
  return { vulnerable: true, severity, confidence, detail, evidence };
}

function miss() {
  return { vulnerable: false };
}

// ═════════════════════════════════════════════════════════════════════════════
// SQL Injection — error-based detection
// ═════════════════════════════════════════════════════════════════════════════

const SQL_ERRORS = [
  // MySQL
  /You have an error in your SQL syntax/i,
  /mysql_fetch_array\(\)/i,
  /Warning: mysql/i,
  /MySQL server version for the right syntax/i,
  // PostgreSQL
  /pg_query\(\): Query failed/i,
  /PostgreSQL.*ERROR/i,
  /PSQLException/i,
  // MSSQL
  /Incorrect syntax near/i,
  /Unclosed quotation mark after the character string/i,
  /SqlException/i,
  // Oracle
  /ORA-\d{5}/,
  /Oracle error/i,
  // SQLite
  /SQLite\/JDBCDriver/i,
  /sqlite3\.OperationalError/i,
  // Generic
  /sql syntax.*error/i,
  /syntax error.*sql/i,
  /unrecognized token/i,
  /unterminated quoted string/i,
];

function checkSqlError(req, res) {
  const body = res.body ?? '';
  for (const re of SQL_ERRORS) {
    const m = body.match(re);
    if (m) {
      return hit(SEV.HIGH, 'high',
        'SQL error message in response body — error-based SQL injection likely',
        m[0].slice(0, 200));
    }
  }
  return miss();
}

// ═════════════════════════════════════════════════════════════════════════════
// XSS — reflected input detection
// ═════════════════════════════════════════════════════════════════════════════

// Canary injected into test requests
const XSS_CANARY = '<hs-xss-probe-a1b2c3>';

function checkXssReflection(req, res) {
  const body = res.body ?? '';
  if (body.includes(XSS_CANARY)) {
    const ct = res.headers?.['content-type'] ?? '';
    // Only flag HTML context — JSON reflection is lower severity
    if (/text\/html/i.test(ct)) {
      return hit(SEV.HIGH, 'high',
        'XSS canary reflected in HTML response without encoding',
        XSS_CANARY);
    }
    return hit(SEV.MEDIUM, 'medium',
      'XSS canary reflected in non-HTML response',
      XSS_CANARY);
  }
  return miss();
}

// ═════════════════════════════════════════════════════════════════════════════
// LFI / Path Traversal
// ═════════════════════════════════════════════════════════════════════════════

const LFI_INDICATORS = [
  /root:x:0:0:/,            // /etc/passwd
  /\[boot loader\]/i,        // boot.ini
  /\[fonts\]/i,              // win.ini
  /# \/etc\/fstab/,          // /etc/fstab
  /<?php/i,                  // PHP source
  /daemon:x:\d+:\d+:/,      // /etc/passwd entry
];

function checkLfi(req, res) {
  const body = res.body ?? '';
  for (const re of LFI_INDICATORS) {
    const m = body.match(re);
    if (m) {
      return hit(SEV.CRITICAL, 'high',
        'LFI/path traversal — sensitive file content in response',
        m[0].slice(0, 100));
    }
  }
  return miss();
}

// ═════════════════════════════════════════════════════════════════════════════
// Open Redirect
// ═════════════════════════════════════════════════════════════════════════════

const REDIRECT_CANARY = 'https://hecate-open-redirect-test.invalid';

function checkOpenRedirect(req, res) {
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers?.['location'] ?? '';
    if (loc.includes('hecate-open-redirect-test.invalid')) {
      return hit(SEV.MEDIUM, 'high',
        `Open redirect to arbitrary URL (status ${res.status})`,
        loc);
    }
  }
  return miss();
}

// ═════════════════════════════════════════════════════════════════════════════
// SSRF indicators — error-based detection
// ═════════════════════════════════════════════════════════════════════════════

const SSRF_INDICATORS = [
  /connection refused/i,
  /failed to connect/i,
  /could not connect/i,
  /getaddrinfo.*failed/i,
  /No route to host/i,
  /Name or service not known/i,
  /Connection timed out/i,
  /dial tcp.*connection refused/i,    // Go errors
  /java\.net\.ConnectException/i,
  /requests\.exceptions\.ConnectionError/i, // Python
];

function checkSsrf(req, res) {
  const body = res.body ?? '';
  for (const re of SSRF_INDICATORS) {
    const m = body.match(re);
    if (m) {
      return hit(SEV.HIGH, 'medium',
        'SSRF indicator — server-side connection error may reveal SSRF capability',
        m[0].slice(0, 200));
    }
  }
  return miss();
}

// ═════════════════════════════════════════════════════════════════════════════
// Security header analysis
// ═════════════════════════════════════════════════════════════════════════════

const REQUIRED_HEADERS = [
  { name: 'x-frame-options',                missing: SEV.MEDIUM, detail: 'Missing X-Frame-Options — clickjacking risk' },
  { name: 'x-content-type-options',         missing: SEV.LOW,    detail: 'Missing X-Content-Type-Options: nosniff' },
  { name: 'x-xss-protection',               missing: SEV.LOW,    detail: 'Missing X-XSS-Protection header' },
  { name: 'strict-transport-security',      missing: SEV.MEDIUM, detail: 'Missing HSTS header — no HTTPS enforcement' },
  { name: 'content-security-policy',        missing: SEV.MEDIUM, detail: 'Missing Content-Security-Policy header' },
  { name: 'referrer-policy',                missing: SEV.LOW,    detail: 'Missing Referrer-Policy header' },
  { name: 'permissions-policy',             missing: SEV.LOW,    detail: 'Missing Permissions-Policy header' },
];

function checkSecurityHeaders(req, res) {
  const headers = res.headers ?? {};
  const missing = [];

  for (const h of REQUIRED_HEADERS) {
    if (!headers[h.name] && !headers[h.name.replace(/-/g, '_')]) {
      missing.push({ header: h.name, severity: h.missing, detail: h.detail });
    }
  }

  if (!missing.length) return miss();

  const maxSev = missing.find(m => m.severity === SEV.MEDIUM) ? SEV.MEDIUM : SEV.LOW;
  return hit(maxSev, 'high',
    `Missing security headers: ${missing.map(m => m.header).join(', ')}`,
    JSON.stringify(missing.map(m => m.detail)));
}

// ═════════════════════════════════════════════════════════════════════════════
// Information disclosure — server headers, versions
// ═════════════════════════════════════════════════════════════════════════════

function checkInfoDisclosure(req, res) {
  const findings = [];
  const headers  = res.headers ?? {};

  // Server version disclosure
  const server = headers['server'];
  if (server && /[\d.]{3,}/.test(server)) {
    findings.push(`Server: ${server}`);
  }

  // X-Powered-By version
  const xpb = headers['x-powered-by'];
  if (xpb) findings.push(`X-Powered-By: ${xpb}`);

  // ASP.NET version
  const aspnet = headers['x-aspnet-version'] ?? headers['x-aspnetmvc-version'];
  if (aspnet) findings.push(`ASP.NET version: ${aspnet}`);

  // Stack traces / debug info in body
  const body = res.body ?? '';
  if (/Traceback \(most recent call/i.test(body)) findings.push('Python traceback in response');
  if (/at [A-Za-z.]+\([A-Za-z.]+:\d+\)/m.test(body))  findings.push('Java/Kotlin stack trace in response');
  if (/at [A-Za-z]+\.<anonymous>/m.test(body)) findings.push('Node.js stack trace in response');
  if (/Parse error.*on line \d+/i.test(body)) findings.push('PHP parse error in response');

  if (!findings.length) return miss();

  return hit(SEV.LOW, 'high',
    'Information disclosure — version or stack info exposed',
    findings.join('; '));
}

// ═════════════════════════════════════════════════════════════════════════════
// Interesting file found (non-404 response to sensitive path)
// ═════════════════════════════════════════════════════════════════════════════

function checkInterestingFile(req, res) {
  if (res.status === 404 || res.status === 403) return miss();

  const url   = req.url ?? '';
  const body  = res.body ?? '';
  const isOk  = res.status >= 200 && res.status < 300;

  // Git config exposure
  if (url.includes('.git/config') && isOk && body.includes('[core]')) {
    return hit(SEV.HIGH, 'high', '.git/config exposed — source code may be downloadable', null);
  }

  // .env exposure
  if (url.endsWith('.env') && isOk && /[A-Z_]+=.+/m.test(body)) {
    return hit(SEV.CRITICAL, 'high', '.env file exposed — environment variables/secrets visible', null);
  }

  // Swagger/OpenAPI
  if (/swagger|openapi/i.test(url) && isOk && /"paths"\s*:/i.test(body)) {
    return hit(SEV.INFO, 'high', 'API schema (Swagger/OpenAPI) exposed', null);
  }

  // phpinfo
  if (/phpinfo/i.test(url) && isOk && /PHP Version/i.test(body)) {
    return hit(SEV.MEDIUM, 'high', 'phpinfo() output exposed', null);
  }

  // Generic: unexpected 200 on sensitive path
  if (isOk) {
    const sensitive = /\.(bak|backup|old|sql|dump|orig|copy|swp|~)$/i;
    if (sensitive.test(url)) {
      return hit(SEV.MEDIUM, 'medium',
        `Backup/sensitive file accessible (${res.status})`, url);
    }
  }

  return miss();
}

// ═════════════════════════════════════════════════════════════════════════════
// CORS misconfiguration
// ═════════════════════════════════════════════════════════════════════════════

function checkCors(req, res) {
  const acao = res.headers?.['access-control-allow-origin'];
  const acac = res.headers?.['access-control-allow-credentials'];

  if (!acao) return miss();

  if (acao === '*' && acac === 'true') {
    return hit(SEV.HIGH, 'high',
      'CORS misconfiguration: wildcard origin with credentials=true', `${acao} / creds: ${acac}`);
  }

  // Reflected origin
  const origin = req.headers?.['origin'];
  if (origin && acao === origin && origin !== '*') {
    // Reflected origin is only a problem if credentials=true
    if (acac === 'true') {
      return hit(SEV.HIGH, 'high',
        'CORS misconfiguration: origin reflected with credentials=true', `${acao} / creds: ${acac}`);
    }
    return hit(SEV.LOW, 'medium',
      'CORS: arbitrary origin reflected (credentials=false)', acao);
  }

  if (acao === '*') {
    return hit(SEV.LOW, 'high',
      'CORS: wildcard origin allowed (check if sensitive data served)', acao);
  }

  return miss();
}

// ═════════════════════════════════════════════════════════════════════════════
// Directory listing
// ═════════════════════════════════════════════════════════════════════════════

function checkDirListing(req, res) {
  const body = res.body ?? '';
  const ct   = res.headers?.['content-type'] ?? '';

  if (res.status !== 200 || !/text\/html/i.test(ct)) return miss();

  const patterns = [
    /Index of\s+\//i,
    /<title>Index of/i,
    /Parent Directory<\/a>/i,
    /Directory listing for/i,
  ];

  for (const re of patterns) {
    if (re.test(body)) {
      return hit(SEV.MEDIUM, 'high',
        'Directory listing enabled — file structure exposed', null);
    }
  }

  return miss();
}

// ═════════════════════════════════════════════════════════════════════════════
// Registry
// ═════════════════════════════════════════════════════════════════════════════

const ALL_CHECKS = [
  { id: 'sql-error',        fn: checkSqlError,         name: 'SQL Error (Error-Based SQLi)' },
  { id: 'xss-reflection',   fn: checkXssReflection,    name: 'XSS Reflection' },
  { id: 'lfi',              fn: checkLfi,               name: 'Local File Inclusion' },
  { id: 'open-redirect',    fn: checkOpenRedirect,      name: 'Open Redirect' },
  { id: 'ssrf',             fn: checkSsrf,              name: 'SSRF Indicator' },
  { id: 'security-headers', fn: checkSecurityHeaders,   name: 'Security Header Analysis' },
  { id: 'info-disclosure',  fn: checkInfoDisclosure,    name: 'Information Disclosure' },
  { id: 'interesting-file', fn: checkInterestingFile,   name: 'Interesting File' },
  { id: 'cors',             fn: checkCors,              name: 'CORS Misconfiguration' },
  { id: 'dir-listing',      fn: checkDirListing,        name: 'Directory Listing' },
];

/**
 * Run all enabled checks against a request-response pair.
 * @param {object} req  - { url, method, headers }
 * @param {object} res  - { status, headers, body }
 * @param {string[]} only  - optional: run only these check IDs
 * @returns {Finding[]}
 */
function runAll(req, res, only = null) {
  const checks = only ? ALL_CHECKS.filter(c => only.includes(c.id)) : ALL_CHECKS;
  const findings = [];

  for (const check of checks) {
    try {
      const r = check.fn(req, res);
      if (r.vulnerable) {
        findings.push({ checkId: check.id, checkName: check.name, ...r });
      }
    } catch { /* check errors don't crash the scanner */ }
  }

  return findings;
}

module.exports = {
  ALL_CHECKS, runAll, SEV,
  XSS_CANARY, REDIRECT_CANARY,
  checkSqlError, checkXssReflection, checkLfi, checkOpenRedirect,
  checkSsrf, checkSecurityHeaders, checkInfoDisclosure,
  checkInterestingFile, checkCors, checkDirListing,
};
