'use strict';

/**
 * HECATE Delivery — Target List Parser
 * Parses CSV target lists into target objects.
 * No external deps — pure Node.
 *
 * Expected columns (case-insensitive, order flexible):
 *   email (required), first_name, last_name, company, title, department
 *   + any custom columns (stored in target.custom{})
 *
 * Supports quoted fields, commas within quotes, and CRLF/LF line endings.
 */

const KNOWN_COLS = new Set([
  'email', 'first_name', 'firstname', 'first', 'given_name',
  'last_name', 'lastname', 'last', 'surname', 'family_name',
  'company', 'organisation', 'organization', 'org',
  'title', 'job_title', 'position', 'role',
  'department', 'dept', 'division', 'team',
]);

const COL_MAP = {
  firstname: 'first_name', first: 'first_name', given_name: 'first_name',
  lastname: 'last_name', last: 'last_name', surname: 'last_name', family_name: 'last_name',
  organisation: 'company', organization: 'company', org: 'company',
  job_title: 'title', position: 'title', role: 'title',
  dept: 'department', division: 'department', team: 'department',
};

/**
 * Parse a CSV string into an array of target objects.
 * @param {string} csv
 * @returns {{ targets: object[], errors: string[], skipped: number }}
 */
function parseCSV(csv) {
  const lines  = splitLines(csv.trim());
  if (lines.length < 2) return { targets: [], errors: ['CSV has no data rows'], skipped: 0 };

  const headers = parseRow(lines[0]).map(h => h.toLowerCase().trim().replace(/\s+/g, '_'));
  const errors  = [];
  const targets = [];

  // Map header index → canonical field name
  const colIndex = headers.map(h => COL_MAP[h] ?? (KNOWN_COLS.has(h) ? h : `custom_${h}`));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseRow(line);
    const target = { custom: {} };

    for (let j = 0; j < colIndex.length; j++) {
      const col = colIndex[j];
      const val = fields[j]?.trim() ?? '';
      if (col.startsWith('custom_')) {
        target.custom[col.slice(7)] = val;
      } else {
        target[col] = val;
      }
    }

    // Normalise email
    if (!target.email) {
      errors.push(`Row ${i + 1}: missing email — skipped`);
      continue;
    }
    target.email = target.email.toLowerCase();

    targets.push(target);
  }

  return { targets, errors, skipped: errors.length };
}

/**
 * Parse a single CSV row respecting quoted fields.
 */
function parseRow(line) {
  const fields = [];
  let   cur    = '';
  let   inQ    = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Split CSV into lines respecting quoted newlines.
 */
function splitLines(csv) {
  const lines = [];
  let   cur   = '';
  let   inQ   = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') { inQ = !inQ; cur += c; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      if (cur) lines.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Deduplicate a target list by email (keeps first occurrence).
 */
function dedup(targets) {
  const seen = new Set();
  return targets.filter(t => {
    const key = t.email?.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Parse raw target objects (already structured — not CSV).
 * Normalises field names.
 */
function normaliseTargets(raw) {
  return raw.map(r => {
    const t = { custom: r.custom ?? {} };
    for (const [k, v] of Object.entries(r)) {
      if (k === 'custom') continue;
      const col = COL_MAP[k.toLowerCase()] ?? k.toLowerCase();
      if (KNOWN_COLS.has(col)) t[col] = v;
      else if (k !== 'custom')  t.custom[k] = v;
    }
    if (!t.email && r.email) t.email = r.email.toLowerCase();
    return t;
  });
}

module.exports = { parseCSV, parseRow, splitLines, dedup, normaliseTargets };
