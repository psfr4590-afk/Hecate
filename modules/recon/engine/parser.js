'use strict';

/**
 * HECATE Recon — HTML Parser
 * Regex-based extraction — no external DOM dep.
 * Extracts:
 *   - All href, src, action, data-url attributes (links + assets)
 *   - Form actions + method
 *   - HTML comments (often contain debug info)
 *   - Inline <script> blocks
 *   - External script src URLs
 *   - Meta tags (generator, description, robots)
 *   - Relative → absolute URL resolution
 *
 * Not a spec-compliant HTML parser. Good enough for red team surface mapping.
 */

// Attribute patterns
const HREF_RE    = /\shref\s*=\s*["']([^"'#]+)["']/gi;
const SRC_RE     = /\ssrc\s*=\s*["']([^"']+)["']/gi;
const ACTION_RE  = /\baction\s*=\s*["']([^"']+)["']/gi;
const DATA_URL_RE = /\bdata-(?:url|href|src|action)\s*=\s*["']([^"']+)["']/gi;

// Form extraction
const FORM_RE    = /<form([^>]*)>([\s\S]*?)<\/form>/gi;
const INPUT_RE   = /<input([^>]*)>/gi;
const ATTR_NAME_RE = /\bname\s*=\s*["']([^"']+)["']/i;
const ATTR_TYPE_RE = /\btype\s*=\s*["']([^"']+)["']/i;
const ATTR_METHOD_RE = /\bmethod\s*=\s*["'](get|post)["']/i;

// Script blocks
const INLINE_SCRIPT_RE  = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi;
const EXTERNAL_SCRIPT_RE = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;

// Comments
const COMMENT_RE = /<!--([\s\S]*?)-->/g;

// Meta tags
const META_RE = /<meta\s+([^>]+)>/gi;

/**
 * Resolve a possibly-relative URL against a base URL.
 * Returns null if resolution fails.
 */
function resolve(raw, base) {
  if (!raw || typeof raw !== 'string') return null;
  raw = raw.trim();
  if (!raw || raw.startsWith('javascript:') || raw.startsWith('mailto:') ||
      raw.startsWith('tel:') || raw.startsWith('data:')) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

/**
 * Extract all values for a regex with one capture group.
 * Resets lastIndex between calls.
 */
function extractAll(re, html) {
  const results = [];
  let m;
  const r = new RegExp(re.source, re.flags);
  while ((m = r.exec(html)) !== null) {
    if (m[1]) results.push(m[1]);
  }
  return results;
}

/**
 * Parse an HTML response body.
 * @param {string} html      - response body
 * @param {string} baseUrl   - URL of this page (for relative resolution)
 * @returns {ParseResult}
 */
function parse(html, baseUrl) {
  if (!html || typeof html !== 'string') {
    return emptyResult(baseUrl);
  }

  // ── Links ────────────────────────────────────────────────────────────────────
  const rawLinks = [
    ...extractAll(HREF_RE,    html),
    ...extractAll(SRC_RE,     html),
    ...extractAll(ACTION_RE,  html),
    ...extractAll(DATA_URL_RE, html),
  ];

  const links = [...new Set(
    rawLinks.map(u => resolve(u, baseUrl)).filter(Boolean)
  )];

  // ── External scripts ─────────────────────────────────────────────────────────
  const scriptUrls = [...new Set(
    extractAll(EXTERNAL_SCRIPT_RE, html)
      .map(u => resolve(u, baseUrl))
      .filter(Boolean)
  )];

  // ── Inline scripts ───────────────────────────────────────────────────────────
  const inlineScripts = extractAll(INLINE_SCRIPT_RE, html)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // ── Comments ─────────────────────────────────────────────────────────────────
  const comments = extractAll(COMMENT_RE, html)
    .map(c => c.trim())
    .filter(c => c.length > 0 && !c.startsWith('[if'));

  // ── Forms ────────────────────────────────────────────────────────────────────
  const forms = [];
  let fm;
  const formRe = new RegExp(FORM_RE.source, FORM_RE.flags);
  while ((fm = formRe.exec(html)) !== null) {
    const attrs  = fm[1];
    const body   = fm[2];
    const action = ATTR_METHOD_RE.test(attrs)
      ? resolve(attrs.match(/action\s*=\s*["']([^"']+)["']/i)?.[1] ?? '', baseUrl)
      : null;
    const method = attrs.match(ATTR_METHOD_RE)?.[1]?.toUpperCase() ?? 'GET';

    const fields = [];
    let im;
    const inputRe = new RegExp(INPUT_RE.source, INPUT_RE.flags);
    while ((im = inputRe.exec(body)) !== null) {
      const a     = im[1];
      const name  = a.match(ATTR_NAME_RE)?.[1];
      const type  = a.match(ATTR_TYPE_RE)?.[1] ?? 'text';
      if (name) fields.push({ name, type });
    }

    forms.push({ action: action ?? baseUrl, method, fields });
  }

  // ── Meta tags ────────────────────────────────────────────────────────────────
  const meta = {};
  let mm;
  const metaRe = new RegExp(META_RE.source, META_RE.flags);
  while ((mm = metaRe.exec(html)) !== null) {
    const a       = mm[1];
    const nameM   = a.match(/\bname\s*=\s*["']([^"']+)["']/i);
    const contentM = a.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
    if (nameM && contentM) meta[nameM[1].toLowerCase()] = contentM[1];

    // <meta http-equiv>
    const heM = a.match(/\bhttp-equiv\s*=\s*["']([^"']+)["']/i);
    if (heM && contentM) meta[`http-equiv:${heM[1].toLowerCase()}`] = contentM[1];
  }

  // ── Page title ───────────────────────────────────────────────────────────────
  const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title  = titleM?.[1]?.trim() ?? null;

  return {
    baseUrl,
    title,
    links,
    scriptUrls,
    inlineScripts,
    comments,
    forms,
    meta,
    linkCount:   links.length,
    formCount:   forms.length,
    commentCount: comments.length,
  };
}

function emptyResult(baseUrl) {
  return {
    baseUrl, title: null, links: [], scriptUrls: [],
    inlineScripts: [], comments: [], forms: [], meta: {},
    linkCount: 0, formCount: 0, commentCount: 0,
  };
}

module.exports = { parse, resolve };
