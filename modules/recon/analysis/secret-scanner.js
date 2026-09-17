'use strict';

/**
 * HECATE Recon — Secret Scanner
 * Scans response bodies and inline scripts for credentials, tokens, and keys.
 * Two-pass: regex pattern matching then entropy scoring for high-value strings.
 *
 * Returns findings with: type, match (redacted), context, confidence, line.
 * The raw matched value is NEVER stored — only a redacted prefix + length.
 */

// ── Pattern definitions ───────────────────────────────────────────────────────

const PATTERNS = [
  // Cloud provider keys
  { type: 'aws-access-key',   re: /\b(AKIA[0-9A-Z]{16})\b/g,                          conf: 'high' },
  { type: 'aws-secret-key',   re: /aws_?secret_?access_?key\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi, conf: 'high' },
  { type: 'gcp-api-key',      re: /\b(AIza[0-9A-Za-z\-_]{35})\b/g,                   conf: 'high' },
  { type: 'azure-client-secret', re: /client[_-]?secret\s*[=:]\s*["']([A-Za-z0-9~._\-]{34,})["']/gi, conf: 'high' },

  // GitHub / GitLab / Bitbucket
  { type: 'github-token',     re: /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/g,               conf: 'high' },
  { type: 'gitlab-token',     re: /\b(glpat-[A-Za-z0-9\-_]{20,})\b/g,               conf: 'high' },

  // JWT
  { type: 'jwt',              re: /\b(eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]{20,})\b/g, conf: 'high' },

  // Private keys
  { type: 'private-key',      re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, conf: 'high' },

  // Database connection strings
  { type: 'db-connection-string', re: /((?:postgres|postgresql|mysql|mongodb|redis|mssql|sqlserver):\/\/[^\s"'<>]+)/gi, conf: 'high' },

  // Generic API keys (heuristic — key= or api_key= near a long random string)
  { type: 'generic-api-key',  re: /(?:api[_-]?key|apikey|access[_-]?key|auth[_-]?key)\s*[=:]\s*["']?([A-Za-z0-9\-_]{20,64})["']?/gi, conf: 'medium' },

  // Passwords in config-like patterns
  { type: 'password-field',   re: /(?:password|passwd|pwd|pass)\s*[=:]\s*["']([^"'\s]{8,})["']/gi, conf: 'medium' },

  // OAuth / bearer tokens
  { type: 'bearer-token',     re: /bearer\s+([A-Za-z0-9\-_.~+/=]{20,})/gi,           conf: 'medium' },

  // Slack webhooks
  { type: 'slack-webhook',    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g, conf: 'high' },

  // Stripe keys
  { type: 'stripe-key',       re: /\b(sk_(?:live|test)_[A-Za-z0-9]{24,})\b/g,       conf: 'high' },
  { type: 'stripe-publishable',re: /\b(pk_(?:live|test)_[A-Za-z0-9]{24,})\b/g,      conf: 'high' },

  // Twilio
  { type: 'twilio-sid',       re: /\b(AC[a-f0-9]{32})\b/g,                           conf: 'high' },

  // NPM tokens
  { type: 'npm-token',        re: /\b(npm_[A-Za-z0-9]{36,})\b/g,                    conf: 'high' },

  // Internal IP ranges in response bodies
  { type: 'internal-ip',      re: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, conf: 'low' },

  // S3 / GCS bucket URLs
  { type: 's3-url',           re: /https?:\/\/([a-z0-9\-]+)\.s3(?:[\-\.][a-z0-9\-]+)?\.amazonaws\.com/gi, conf: 'medium' },
  { type: 'gcs-url',          re: /https?:\/\/storage\.googleapis\.com\/([a-z0-9\-_.]+)/gi, conf: 'medium' },
];

// ── Shannon entropy ───────────────────────────────────────────────────────────

function entropy(str) {
  const freq = {};
  for (const c of str) freq[c] = (freq[c] ?? 0) + 1;
  const len = str.length;
  return -Object.values(freq).reduce((acc, f) => {
    const p = f / len;
    return acc + p * Math.log2(p);
  }, 0);
}

// Strings above this entropy threshold warrant closer inspection
const ENTROPY_THRESHOLD = 3.5;

// Look for high-entropy strings in JS variable assignments
const ENTROPY_SCAN_RE = /["']([A-Za-z0-9+/=\-_]{16,64})["']/g;

/**
 * Scan a text body for secrets.
 * @param {string} body        - response body or script content
 * @param {string} sourceUrl   - URL the body came from
 * @returns {SecretFinding[]}
 */
function scan(body, sourceUrl = '') {
  if (!body || typeof body !== 'string') return [];

  const findings = [];
  const lines    = body.split('\n');

  // ── Pattern scan ────────────────────────────────────────────────────────────
  for (const { type, re, conf } of PATTERNS) {
    const pattern = new RegExp(re.source, re.flags);
    let m;
    while ((m = pattern.exec(body)) !== null) {
      const raw     = m[1] ?? m[0];
      const line    = lineNumber(body, m.index);
      const context = extractContext(lines, line - 1);

      findings.push({
        type,
        conf,
        source:   sourceUrl,
        line,
        context,
        redacted: redact(raw),
        length:   raw.length,
      });
    }
  }

  // ── Entropy scan ─────────────────────────────────────────────────────────────
  const entropyRe = new RegExp(ENTROPY_SCAN_RE.source, ENTROPY_SCAN_RE.flags);
  let em;
  const seen = new Set();

  while ((em = entropyRe.exec(body)) !== null) {
    const candidate = em[1];
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const e = entropy(candidate);
    if (e >= ENTROPY_THRESHOLD) {
      const line    = lineNumber(body, em.index);
      const context = extractContext(lines, line - 1);
      findings.push({
        type:     'high-entropy-string',
        conf:     'low',
        source:   sourceUrl,
        line,
        context,
        redacted: redact(candidate),
        length:   candidate.length,
        entropy:  +e.toFixed(2),
      });
    }
  }

  // Deduplicate by redacted value + type
  const deduped = [];
  const dKeys   = new Set();
  for (const f of findings) {
    const k = `${f.type}:${f.redacted}`;
    if (!dKeys.has(k)) { dKeys.add(k); deduped.push(f); }
  }

  return deduped;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function lineNumber(body, index) {
  return body.slice(0, index).split('\n').length;
}

function extractContext(lines, lineIdx) {
  const start = Math.max(0, lineIdx - 1);
  const end   = Math.min(lines.length - 1, lineIdx + 1);
  return lines.slice(start, end + 1).join('\n').slice(0, 200);
}

/**
 * Redact a secret value — show only the first 4 chars + length.
 * Never store the full value.
 */
function redact(val) {
  if (!val || val.length < 4) return '[REDACTED]';
  return `${val.slice(0, 4)}…[${val.length}]`;
}

module.exports = { scan, entropy, redact };
