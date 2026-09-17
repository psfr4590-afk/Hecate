'use strict';

/**
 * HECATE Recon — Semantic Page Classifier
 * Classifies pages by attack-surface relevance.
 * Categories: login, admin, api, upload, search, registration,
 *             error, redirect, backup, config, debug, interesting, generic
 *
 * Returns { type, confidence, signals[] }
 */

const CLASSIFIERS = [
  {
    type: 'login',
    conf: 'high',
    urlPatterns: [/\/login\b/i, /\/signin\b/i, /\/auth\b/i, /\/sso\b/i, /\/oauth\b/i, /\/wp-login/i],
    bodyPatterns: [/type=["']password["']/i, /name=["']password["']/i, /name=["']passwd["']/i],
    titlePatterns: [/\blog.?in\b/i, /sign.?in/i, /authenticate/i],
    metaPatterns:  [],
    score: (url, body, title, meta) => {
      let s = 0;
      if (/\/login|\/signin|\/auth/i.test(url)) s += 3;
      if (/type=["']password["']/i.test(body))  s += 3;
      if (/\blog.?in\b|\bsign.?in\b/i.test(title)) s += 2;
      return s;
    },
  },

  {
    type: 'admin',
    conf: 'high',
    score: (url, body, title) => {
      let s = 0;
      if (/\/admin|\/administrator|\/wp-admin|\/dashboard|\/control.?panel|\/manage|\/backend/i.test(url)) s += 3;
      if (/admin.?panel|dashboard|control panel/i.test(title)) s += 2;
      if (/id=["']?admin|class=["']?admin/i.test(body)) s += 1;
      return s;
    },
  },

  {
    type: 'api',
    conf: 'high',
    score: (url, body, title, meta, headers) => {
      let s = 0;
      if (/\/api\/|\/v\d+\/|\/graphql|\/rest\/|\/swagger|\/openapi/i.test(url)) s += 3;
      const ct = (headers?.['content-type'] ?? '');
      if (/application\/json|application\/xml/i.test(ct)) s += 2;
      if (/swagger|openapi|"paths"\s*:/i.test(body)) s += 2;
      return s;
    },
  },

  {
    type: 'upload',
    conf: 'high',
    score: (url, body) => {
      let s = 0;
      if (/\/upload|\/file|\/attachment|\/import/i.test(url)) s += 2;
      if (/type=["']file["']/i.test(body)) s += 3;
      if (/enctype=["']multipart\/form-data["']/i.test(body)) s += 3;
      return s;
    },
  },

  {
    type: 'search',
    conf: 'medium',
    score: (url, body) => {
      let s = 0;
      if (/\/search|[?&]q=|[?&]query=|[?&]s=/i.test(url)) s += 2;
      if (/name=["']?(?:q|query|search|s)["']?/i.test(body)) s += 2;
      return s;
    },
  },

  {
    type: 'registration',
    conf: 'high',
    score: (url, body, title) => {
      let s = 0;
      if (/\/register|\/signup|\/join|\/create.?account/i.test(url)) s += 3;
      if (/\bregister\b|\bsign.?up\b|\bjoin\b/i.test(title)) s += 2;
      if (/name=["']email["'][^>]*>|name=["']confirm/i.test(body)) s += 1;
      return s;
    },
  },

  {
    type: 'error',
    conf: 'medium',
    score: (url, body, title, meta, headers, status) => {
      let s = 0;
      if (status >= 400) s += 3;
      if (/error|exception|traceback|stack trace/i.test(title)) s += 2;
      if (/at [A-Za-z.]+\(.*:\d+:\d+\)|Traceback \(most recent/i.test(body)) s += 3;
      return s;
    },
  },

  {
    type: 'debug',
    conf: 'high',
    score: (url, body) => {
      let s = 0;
      if (/\/debug|\/trace|\/profil|phpinfo/i.test(url)) s += 3;
      if (/phpinfo\(\)|<b>DEBUG<\/b>|XDEBUG_SESSION|DEBUG=True/i.test(body)) s += 4;
      if (/dump\(|var_dump\(|console\.log\(/i.test(body)) s += 1;
      return s;
    },
  },

  {
    type: 'backup',
    conf: 'high',
    score: (url) => {
      let s = 0;
      if (/\.(bak|backup|old|orig|copy|tmp|swp|~)($|\?)/i.test(url)) s += 4;
      if (/backup|\.sql|dump\./i.test(url)) s += 2;
      return s;
    },
  },

  {
    type: 'config',
    conf: 'high',
    score: (url, body) => {
      let s = 0;
      if (/\.(env|conf|config|cfg|ini|yml|yaml|json|xml)($|\?)/i.test(url)) s += 3;
      if (/\.git\/|\/config\.php|\/settings\.py|\/application\.properties/i.test(url)) s += 4;
      if (/DB_HOST|DATABASE_URL|SECRET_KEY|API_KEY/i.test(body)) s += 3;
      return s;
    },
  },

  {
    type: 'redirect',
    conf: 'high',
    score: (url, body, title, meta, headers, status) => {
      let s = 0;
      if (status >= 300 && status < 400) s += 4;
      if (/\/redirect|\/redir|[?&]url=|[?&]next=|[?&]return=/i.test(url)) s += 2;
      return s;
    },
  },
];

const THRESHOLD = 3; // minimum score to classify

/**
 * Classify a page.
 * @param {object} opts
 * @param {string}  opts.url
 * @param {string}  opts.body
 * @param {string}  opts.title
 * @param {object}  opts.meta
 * @param {object}  opts.headers
 * @param {number}  opts.status
 * @returns {{ type, confidence, score, signals: string[] }}
 */
function classify(opts = {}) {
  const { url = '', body = '', title = '', meta = {}, headers = {}, status = 200 } = opts;

  let best    = null;
  let bestScore = 0;
  const allHits = [];

  for (const cls of CLASSIFIERS) {
    const score = cls.score(url, body, title, meta, headers, status);
    if (score >= THRESHOLD) {
      allHits.push({ type: cls.type, score, conf: cls.conf });
      if (score > bestScore) {
        bestScore = score;
        best      = cls;
      }
    }
  }

  if (!best) {
    return { type: 'generic', confidence: 'low', score: 0, signals: [] };
  }

  const signals = allHits.map(h => `${h.type}(${h.score})`);
  return {
    type:       best.type,
    confidence: bestScore >= 6 ? 'high' : bestScore >= 3 ? 'medium' : 'low',
    score:      bestScore,
    signals,
    allTypes:   allHits.map(h => h.type),
  };
}

module.exports = { classify };
