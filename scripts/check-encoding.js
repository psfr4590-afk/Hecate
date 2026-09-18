'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'ui/dist',
  'data',
  'logs',
  'coverage',
  '.nyc_output',
]);

const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.json', '.css', '.html', '.md', '.yml', '.yaml', '.ps1', '.bat', '.txt',
]);

// Keep the detector's own source ASCII-only so it cannot flag its marker table.
// The escape sequences below produce the Unicode characters at runtime.
const MOJIBAKE_MARKERS = [
  '\uFFFD',
  '\u00C3',
  '\u00C2',
  '\u00E2\u20AC',
  '\u00E2\u20AC\u2122',
  '\u00E2\u20AC\u0153',
  '\u00E2\u20AC\uFFFD',
  '\u00E2\u20AC\u2013',
  '\u00E2\u20AC\u2014',
  '\u00E2\u20AC\u2026',
  '\u00E2\u2020',
  '\u00E2\u0153',
];

const failures = [];

function shouldSkip(relativePath) {
  return relativePath.split(path.sep).some(part => SKIP_DIRS.has(part));
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(ROOT, full);

    if (shouldSkip(relative)) continue;

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (error) {
      failures.push(`${relative}: invalid UTF-8 or unreadable text file (${error.message})`);
      continue;
    }

    for (const marker of MOJIBAKE_MARKERS) {
      if (text.includes(marker)) {
        failures.push(`${relative}: suspicious mojibake marker ${JSON.stringify(marker)}`);
      }
    }
  }
}

walk(ROOT);

if (failures.length) {
  console.error('Encoding check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Encoding check passed: UTF-8 text files contain no known mojibake markers.');
