'use strict';

/**
 * HECATE Recon — Technology Fingerprinter
 * Identifies server software, frameworks, CMS, CDN, WAF, and language
 * runtime from HTTP response headers and body patterns.
 *
 * Returns a structured tech stack object with confidence levels.
 * Confidence: 'high' (definitive signal) | 'medium' | 'low' (heuristic)
 */

// ── Header-based signatures ───────────────────────────────────────────────────

const HEADER_SIGS = [

  // Servers
  { field: 'server', pattern: /apache\/([\d.]+)/i,   tech: 'Apache',     cat: 'server',   conf: 'high',   version: 1 },
  { field: 'server', pattern: /nginx\/([\d.]+)/i,    tech: 'nginx',      cat: 'server',   conf: 'high',   version: 1 },
  { field: 'server', pattern: /\bnginx\b/i,          tech: 'nginx',      cat: 'server',   conf: 'medium' },
  { field: 'server', pattern: /iis\/([\d.]+)/i,      tech: 'IIS',        cat: 'server',   conf: 'high',   version: 1 },
  { field: 'server', pattern: /cloudflare/i,         tech: 'Cloudflare', cat: 'cdn',      conf: 'high' },
  { field: 'server', pattern: /lighttpd\/([\d.]+)/i, tech: 'Lighttpd',   cat: 'server',   conf: 'high',   version: 1 },
  { field: 'server', pattern: /caddy\/([\d.]+)/i,    tech: 'Caddy',      cat: 'server',   conf: 'high',   version: 1 },
  { field: 'server', pattern: /openresty\/([\d.]+)/i,tech: 'OpenResty',  cat: 'server',   conf: 'high',   version: 1 },
  { field: 'server', pattern: /gunicorn\/([\d.]+)/i, tech: 'Gunicorn',   cat: 'server',   conf: 'high',   version: 1 },

  // Language runtimes
  { field: 'x-powered-by', pattern: /php\/([\d.]+)/i,    tech: 'PHP',       cat: 'language', conf: 'high',   version: 1 },
  { field: 'x-powered-by', pattern: /asp\.net/i,          tech: 'ASP.NET',   cat: 'language', conf: 'high' },
  { field: 'x-powered-by', pattern: /express/i,           tech: 'Express',   cat: 'framework',conf: 'high' },
  { field: 'x-powered-by', pattern: /next\.js/i,          tech: 'Next.js',   cat: 'framework',conf: 'high' },
  { field: 'x-powered-by', pattern: /django/i,            tech: 'Django',    cat: 'framework',conf: 'high' },

  // CDN / WAF
  { field: 'cf-ray',           pattern: /.+/,             tech: 'Cloudflare', cat: 'cdn',     conf: 'high' },
  { field: 'x-amz-cf-id',     pattern: /.+/,             tech: 'CloudFront', cat: 'cdn',     conf: 'high' },
  { field: 'x-fastly-request-id', pattern: /.+/,         tech: 'Fastly',     cat: 'cdn',     conf: 'high' },
  { field: 'x-akamai-session-id', pattern: /.+/,         tech: 'Akamai',     cat: 'cdn',     conf: 'high' },
  { field: 'x-sucuri-id',     pattern: /.+/,             tech: 'Sucuri',     cat: 'waf',     conf: 'high' },
  { field: 'x-fw-hash',       pattern: /.+/,             tech: 'Wordfence',  cat: 'waf',     conf: 'medium' },

  // Auth / SSO
  { field: 'www-authenticate', pattern: /bearer/i,        tech: 'JWT/OAuth2', cat: 'auth',    conf: 'medium' },
  { field: 'www-authenticate', pattern: /ntlm/i,          tech: 'NTLM',       cat: 'auth',    conf: 'high' },
  { field: 'www-authenticate', pattern: /negotiate/i,     tech: 'Kerberos',   cat: 'auth',    conf: 'high' },

  // Observability
  { field: 'x-request-id',    pattern: /.+/,             tech: 'RequestID',  cat: 'infra',   conf: 'low' },
  { field: 'x-trace-id',      pattern: /.+/,             tech: 'Tracing',    cat: 'infra',   conf: 'low' },
];

// ── Cookie-based signatures ───────────────────────────────────────────────────

const COOKIE_SIGS = [
  { pattern: /PHPSESSID/,         tech: 'PHP',           cat: 'language', conf: 'high' },
  { pattern: /ASPSESSIONID/i,     tech: 'ASP Classic',   cat: 'language', conf: 'high' },
  { pattern: /ASP\.NET_SessionId/i,tech: 'ASP.NET',      cat: 'language', conf: 'high' },
  { pattern: /JSESSIONID/,        tech: 'Java/JVM',      cat: 'language', conf: 'high' },
  { pattern: /laravel_session/,   tech: 'Laravel',       cat: 'framework',conf: 'high' },
  { pattern: /_rails_session/,    tech: 'Ruby on Rails', cat: 'framework',conf: 'high' },
  { pattern: /django_/i,          tech: 'Django',        cat: 'framework',conf: 'high' },
  { pattern: /wordpress_/i,       tech: 'WordPress',     cat: 'cms',      conf: 'high' },
  { pattern: /cf_clearance/,      tech: 'Cloudflare',    cat: 'cdn',      conf: 'high' },
  { pattern: /__cfduid/,          tech: 'Cloudflare',    cat: 'cdn',      conf: 'medium' },
];

// ── Body-based signatures ─────────────────────────────────────────────────────

const BODY_SIGS = [
  { pattern: /wp-content\//i,               tech: 'WordPress',     cat: 'cms',      conf: 'high' },
  { pattern: /wp-json\//i,                  tech: 'WordPress',     cat: 'cms',      conf: 'high' },
  { pattern: /Drupal\.settings/i,           tech: 'Drupal',        cat: 'cms',      conf: 'high' },
  { pattern: /\/sites\/default\/files\//i,  tech: 'Drupal',        cat: 'cms',      conf: 'medium' },
  { pattern: /Joomla!/i,                    tech: 'Joomla',        cat: 'cms',      conf: 'high' },
  { pattern: /content="Joomla/i,            tech: 'Joomla',        cat: 'cms',      conf: 'high' },
  { pattern: /Magento/i,                    tech: 'Magento',       cat: 'ecommerce',conf: 'high' },
  { pattern: /Shopify\.theme/i,             tech: 'Shopify',       cat: 'ecommerce',conf: 'high' },
  { pattern: /_next\/static\//i,           tech: 'Next.js',       cat: 'framework',conf: 'high' },
  { pattern: /nuxt-link/i,                  tech: 'Nuxt.js',       cat: 'framework',conf: 'high' },
  { pattern: /ng-version=/i,                tech: 'Angular',       cat: 'framework',conf: 'high' },
  { pattern: /data-reactroot/i,             tech: 'React',         cat: 'framework',conf: 'high' },
  { pattern: /vue-meta/i,                   tech: 'Vue.js',        cat: 'framework',conf: 'high' },
  { pattern: /data-svelte/i,                tech: 'Svelte',        cat: 'framework',conf: 'high' },
  { pattern: /window\.Laravel\s*=/i,        tech: 'Laravel',       cat: 'framework',conf: 'high' },
  { pattern: /Rails\.env/i,                 tech: 'Ruby on Rails', cat: 'framework',conf: 'high' },
  { pattern: /content="Django/i,            tech: 'Django',        cat: 'framework',conf: 'medium' },
  { pattern: /strapi/i,                     tech: 'Strapi',        cat: 'cms',      conf: 'medium' },
  { pattern: /ghost-url/i,                  tech: 'Ghost',         cat: 'cms',      conf: 'high' },
  { pattern: /cdn\.jsdelivr\.net/i,         tech: 'jsDelivr CDN',  cat: 'cdn',      conf: 'medium' },
  { pattern: /fonts\.googleapis\.com/i,     tech: 'Google Fonts',  cat: 'cdn',      conf: 'high' },
  { pattern: /recaptcha\.net|grecaptcha/i,  tech: 'reCAPTCHA',     cat: 'security', conf: 'high' },
  { pattern: /hcaptcha\.com/i,              tech: 'hCaptcha',      cat: 'security', conf: 'high' },
];

// ── Meta generator signatures ─────────────────────────────────────────────────

const GENERATOR_SIGS = [
  { pattern: /WordPress ([\d.]+)/i, tech: 'WordPress', cat: 'cms', conf: 'high', version: 1 },
  { pattern: /Drupal ([\d.]+)/i,    tech: 'Drupal',    cat: 'cms', conf: 'high', version: 1 },
  { pattern: /Joomla! ([\d.]+)/i,   tech: 'Joomla',    cat: 'cms', conf: 'high', version: 1 },
  { pattern: /Ghost ([\d.]+)/i,     tech: 'Ghost',     cat: 'cms', conf: 'high', version: 1 },
];

/**
 * Fingerprint a response.
 * @param {object} result  - FetchResult from fetcher
 * @param {object} parsed  - ParseResult from parser
 * @returns {TechStack}
 */
function fingerprint(result, parsed = {}) {
  const seen    = new Map(); // tech name → best detection
  const headers = result.headers ?? {};
  const body    = result.body    ?? '';
  const cookie  = headers['set-cookie'] ?? '';
  const generator = (parsed.meta ?? {})['generator'] ?? '';

  function add(tech, cat, conf, version = null) {
    const existing = seen.get(tech);
    if (!existing || confRank(conf) > confRank(existing.conf)) {
      seen.set(tech, { tech, cat, conf, ...(version ? { version } : {}) });
    }
  }

  // Header sigs
  for (const sig of HEADER_SIGS) {
    const val = headers[sig.field] ?? '';
    if (!val) continue;
    const m = val.match(sig.pattern);
    if (m) {
      const ver = sig.version ? (m[sig.version] ?? null) : null;
      add(sig.tech, sig.cat, sig.conf, ver);
    }
  }

  // Cookie sigs
  for (const sig of COOKIE_SIGS) {
    if (sig.pattern.test(cookie)) add(sig.tech, sig.cat, sig.conf);
  }

  // Body sigs
  for (const sig of BODY_SIGS) {
    if (sig.pattern.test(body)) add(sig.tech, sig.cat, sig.conf);
  }

  // Generator meta
  for (const sig of GENERATOR_SIGS) {
    const m = generator.match(sig.pattern);
    if (m) add(sig.tech, sig.cat, sig.conf, sig.version ? (m[sig.version] ?? null) : null);
  }

  const detections = [...seen.values()];

  return {
    detections,
    summary: detections.map(d => d.version ? `${d.tech}/${d.version}` : d.tech),
    byCategory: groupBy(detections, 'cat'),
    hasWaf:   detections.some(d => d.cat === 'waf'),
    hasCdn:   detections.some(d => d.cat === 'cdn'),
    cms:      detections.find(d => d.cat === 'cms')?.tech ?? null,
    server:   detections.find(d => d.cat === 'server')?.tech ?? null,
    language: detections.find(d => d.cat === 'language')?.tech ?? null,
  };
}

function confRank(c) {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}

function groupBy(arr, key) {
  const out = {};
  for (const item of arr) {
    (out[item[key]] ??= []).push(item);
  }
  return out;
}

module.exports = { fingerprint };
