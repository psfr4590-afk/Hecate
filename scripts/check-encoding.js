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

const MOJIBAKE_MARKERS = [
  '�',
  'Ã',
  'Â',
  'â€',
  'â€™',
  'â€œ',
  'â€�',
  'â€“',
  'â€”',
  'â€¦',
  'â†',
  'âœ',
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
