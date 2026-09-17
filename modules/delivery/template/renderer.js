'use strict';

/**
 * HECATE Delivery — Template Renderer
 * Renders email templates with target-specific variables.
 * Injects open-tracking pixel and wraps links with click-tracking redirects.
 *
 * Template syntax: {{variable}} — simple, no logic, no external dep.
 * Available variables: first_name, last_name, full_name, email,
 *   company, title, department, tracking_id, + any custom target fields.
 */

const DEFAULT_PIXEL_PATH   = '/__t/open';
const DEFAULT_REDIRECT_PATH = '/__t/click';

/**
 * Render a template string with target variables.
 * @param {string} template       - raw template (HTML or text)
 * @param {object} vars           - variable map
 * @param {object} opts
 * @param {string} opts.trackingId    - unique per-send tracking ID
 * @param {string} opts.trackingBase  - base URL for tracking (e.g. 'https://phish.io')
 * @param {boolean} opts.injectPixel  - inject open-tracking pixel (HTML only)
 * @param {boolean} opts.wrapLinks    - wrap hrefs with click-tracking redirects
 * @returns {string} rendered output
 */
function render(template, vars = {}, opts = {}) {
  if (!template) return '';

  // Variable substitution
  let out = substitute(template, vars);

  // HTML-only transformations
  if (opts.trackingBase && opts.trackingId) {
    if (opts.wrapLinks !== false) {
      out = wrapLinks(out, opts.trackingBase, opts.trackingId);
    }
    if (opts.injectPixel !== false) {
      out = injectPixel(out, opts.trackingBase, opts.trackingId);
    }
  }

  return out;
}

/**
 * Replace {{variable}} placeholders. Unknown vars left blank by default.
 */
function substitute(template, vars, leaveUnknown = false) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
    if (key in vars) return String(vars[key] ?? '');
    return leaveUnknown ? match : '';
  });
}

/**
 * Wrap all href links with click-tracking redirects.
 * Skips mailto:, tel:, and already-wrapped links.
 */
function wrapLinks(html, trackingBase, trackingId) {
  let linkIdx = 0;
  return html.replace(/href\s*=\s*["']([^"']+)["']/gi, (match, url) => {
    if (/^(mailto:|tel:|#|javascript:)/i.test(url)) return match;
    if (url.includes(trackingBase)) return match; // already wrapped
    const encoded   = encodeURIComponent(url);
    const linkId    = linkIdx++;
    const trackUrl  = `${trackingBase}${DEFAULT_REDIRECT_PATH}/${trackingId}/${linkId}?u=${encoded}`;
    const quote     = match.includes('"') ? '"' : "'";
    return `href=${quote}${trackUrl}${quote}`;
  });
}

/**
 * Inject a 1×1 tracking pixel before </body>.
 */
function injectPixel(html, trackingBase, trackingId) {
  const pixelUrl = `${trackingBase}${DEFAULT_PIXEL_PATH}/${trackingId}`;
  const pixel    = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${pixel}\n</body>`);
  }
  return html + '\n' + pixel;
}

/**
 * Extract all {{variable}} names from a template.
 */
function extractVars(template) {
  const found = new Set();
  for (const [, key] of template.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)) {
    found.add(key);
  }
  return [...found];
}

/**
 * Build a variable map from a target record.
 * Merges standard fields + custom fields.
 */
function buildVars(target, trackingId, extra = {}) {
  const first = target.firstName ?? target.first_name ?? '';
  const last  = target.lastName  ?? target.last_name  ?? '';
  return {
    first_name:  first,
    last_name:   last,
    full_name:   `${first} ${last}`.trim() || target.email,
    email:       target.email ?? '',
    company:     target.company     ?? '',
    title:       target.title       ?? '',
    department:  target.department  ?? '',
    tracking_id: trackingId         ?? '',
    ...target.custom ?? {},
    ...extra,
  };
}

module.exports = {
  render, substitute, wrapLinks, injectPixel,
  extractVars, buildVars,
  DEFAULT_PIXEL_PATH, DEFAULT_REDIRECT_PATH,
};
