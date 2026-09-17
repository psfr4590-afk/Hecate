'use strict';

/**
 * HECATE Evil Proxy — Phishlet Loader
 * Loads phishlet definitions from JSON files.
 *
 * Search order for phishlet files:
 *   1. <hecateDataDir>/phishlets/<name>.json
 *   2. Built-in EXAMPLES from schema.js
 *
 * Evilginx3 YAML import: parse the YAML externally (e.g. via js-yaml) and
 * pass the resulting object to loadObject(). The CLI command
 * `hecate evil-proxy import-phishlet` handles the conversion.
 */

const fs   = require('fs');
const path = require('path');
const { validate, normalise, EXAMPLES } = require('./schema');

let _phishletDir = null;

function setPhishletDir(dir) {
  _phishletDir = dir;
}

/**
 * Load a phishlet by name.
 * Checks disk first, falls back to built-in examples.
 * @param {string} name
 * @returns {NormalisedPhishlet}
 */
function load(name) {
  // Try disk
  if (_phishletDir) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error('Invalid phishlet name');
    }
    const baseDir = path.resolve(_phishletDir);
    const filePath = path.resolve(baseDir, `${name}.json`);
    if (path.dirname(filePath) !== baseDir) {
      throw new Error('Invalid phishlet path');
    }
    if (fs.existsSync(filePath)) {
      return loadFile(filePath);
    }
  }

  // Try built-in
  if (EXAMPLES[name]) {
    return loadObject(EXAMPLES[name]);
  }

  throw new Error(`Phishlet '${name}' not found. Check phishlet directory or use a built-in: ${Object.keys(EXAMPLES).join(', ')}`);
}

/**
 * Load a phishlet from a file path.
 */
function loadFile(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse phishlet file ${filePath}: ${err.message}`);
  }
  return loadObject(raw, filePath);
}

/**
 * Load a phishlet from a raw object (already parsed).
 */
function loadObject(raw, source = '<object>') {
  validate(raw, source);
  return normalise(raw);
}

/**
 * List all available phishlets (disk + built-ins).
 */
function list() {
  const names = new Set(Object.keys(EXAMPLES));

  if (_phishletDir && fs.existsSync(_phishletDir)) {
    for (const f of fs.readdirSync(_phishletDir)) {
      if (f.endsWith('.json')) names.add(f.replace('.json', ''));
    }
  }

  return [...names].sort();
}

module.exports = { load, loadFile, loadObject, list, setPhishletDir, EXAMPLES };
