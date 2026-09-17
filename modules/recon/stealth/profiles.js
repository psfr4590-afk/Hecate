'use strict';

/**
 * HECATE Recon — Stealth Profiles
 * Operator-selectable browser personas. Each profile defines:
 *   - User-Agent
 *   - Accept / Accept-Language / Accept-Encoding headers
 *   - Sec-Fetch-* headers (modern browser fingerprinting signal)
 *   - Timing jitter range (ms) between requests
 *
 * Purpose: blend crawl traffic into legitimate browser patterns.
 * Not a guarantee — just raises the bar for passive detection.
 */

const PROFILES = {

  'chrome-win': {
    label:   'Chrome 124 / Windows 11',
    ua:      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    headers: {
      'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language':           'en-US,en;q=0.9',
      'Accept-Encoding':           'gzip, deflate, br',
      'Sec-CH-UA':                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-CH-UA-Mobile':          '?0',
      'Sec-CH-UA-Platform':        '"Windows"',
      'Sec-Fetch-Dest':            'document',
      'Sec-Fetch-Mode':            'navigate',
      'Sec-Fetch-Site':            'none',
      'Sec-Fetch-User':            '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    jitterMs: [800, 3000],
  },

  'firefox-linux': {
    label:   'Firefox 125 / Linux',
    ua:      'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
    headers: {
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest':  'document',
      'Sec-Fetch-Mode':  'navigate',
      'Sec-Fetch-Site':  'none',
      'Sec-Fetch-User':  '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    jitterMs: [1000, 3500],
  },

  'safari-mac': {
    label:   'Safari 17 / macOS Sonoma',
    ua:      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    headers: {
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    jitterMs: [1200, 4000],
  },

  'edge-win': {
    label:   'Edge 124 / Windows 11',
    ua:      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    headers: {
      'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language':           'en-US,en;q=0.9',
      'Accept-Encoding':           'gzip, deflate, br',
      'Sec-CH-UA':                 '"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"',
      'Sec-CH-UA-Mobile':          '?0',
      'Sec-CH-UA-Platform':        '"Windows"',
      'Sec-Fetch-Dest':            'document',
      'Sec-Fetch-Mode':            'navigate',
      'Sec-Fetch-Site':            'none',
      'Sec-Fetch-User':            '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    jitterMs: [900, 3200],
  },

  'mobile-android': {
    label:   'Chrome 124 / Android 14',
    ua:      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
    headers: {
      'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language':           'en-US,en;q=0.9',
      'Accept-Encoding':           'gzip, deflate, br',
      'Sec-CH-UA':                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-CH-UA-Mobile':          '?1',
      'Sec-CH-UA-Platform':        '"Android"',
      'Sec-Fetch-Dest':            'document',
      'Sec-Fetch-Mode':            'navigate',
      'Sec-Fetch-Site':            'none',
      'Upgrade-Insecure-Requests': '1',
    },
    jitterMs: [600, 2500],
  },

  // Deliberately minimal — for environments where generic UA is fine
  'generic': {
    label:   'Generic HTTP Client',
    ua:      'Mozilla/5.0 (compatible)',
    headers: {
      'Accept':          'text/html,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
    },
    jitterMs: [200, 800],
  },
};

const PROFILE_NAMES = Object.keys(PROFILES);
const DEFAULT_PROFILE = 'chrome-win';

/**
 * Get a profile by name (throws on unknown).
 */
function get(name = DEFAULT_PROFILE) {
  const p = PROFILES[name];
  if (!p) throw new Error(`Unknown stealth profile: ${name}. Valid: ${PROFILE_NAMES.join(', ')}`);
  return p;
}

/**
 * Build request headers for a fetch call.
 * Merges profile headers with any caller-supplied overrides.
 * @param {string} profileName
 * @param {object} overrides    - additional headers (e.g. Cookie, Referer)
 */
function buildHeaders(profileName, overrides = {}) {
  const p = get(profileName);
  return {
    'User-Agent': p.ua,
    ...p.headers,
    ...overrides,
  };
}

/**
 * Return a random jitter delay (ms) for this profile.
 */
function jitter(profileName) {
  const [min, max] = get(profileName).jitterMs;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for the profile's jitter duration.
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function applyJitter(profileName) {
  await sleep(jitter(profileName));
}

module.exports = { PROFILES, PROFILE_NAMES, DEFAULT_PROFILE, get, buildHeaders, jitter, applyJitter, sleep };
