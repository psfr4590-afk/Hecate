'use strict';

/**
 * HECATE Delivery — Template Validator
 * Validates email templates before campaign launch.
 * Returns { valid, errors[], warnings[] }.
 */

const { extractVars } = require('./renderer');

// Variables that must appear in a valid phishing template
const REQUIRED_VARS  = new Set(['tracking_id']);
// Variables strongly recommended
const SUGGESTED_VARS = new Set(['first_name', 'email']);

/**
 * Validate an email template definition.
 * @param {object} tpl
 * @param {string} tpl.name
 * @param {string} tpl.subject
 * @param {string} tpl.htmlBody
 * @param {string} tpl.textBody
 * @param {string} tpl.fromName
 * @param {string} tpl.fromEmail
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validate(tpl) {
  const errors   = [];
  const warnings = [];

  // Required fields
  if (!tpl.name?.trim())      errors.push('name is required');
  if (!tpl.subject?.trim())   errors.push('subject is required');
  if (!tpl.fromEmail?.trim()) errors.push('fromEmail is required');
  if (!tpl.htmlBody?.trim() && !tpl.textBody?.trim()) {
    errors.push('at least one of htmlBody or textBody is required');
  }

  // fromEmail format
  if (tpl.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tpl.fromEmail)) {
    errors.push(`fromEmail '${tpl.fromEmail}' is not a valid email address`);
  }

  // Check template variables
  const allContent = [tpl.subject ?? '', tpl.htmlBody ?? '', tpl.textBody ?? ''].join('\n');
  const usedVars   = new Set(extractVars(allContent));

  for (const v of REQUIRED_VARS) {
    if (!usedVars.has(v)) {
      warnings.push(`Template does not use {{${v}}} — tracking may not work`);
    }
  }

  for (const v of SUGGESTED_VARS) {
    if (!usedVars.has(v)) {
      warnings.push(`Consider adding {{${v}}} for personalisation`);
    }
  }

  // HTML sanity checks
  if (tpl.htmlBody) {
    if (!/<html/i.test(tpl.htmlBody) && !/<body/i.test(tpl.htmlBody)) {
      warnings.push('htmlBody appears to be a fragment — consider wrapping in <html><body>');
    }
    if (/<script/i.test(tpl.htmlBody)) {
      warnings.push('htmlBody contains <script> tags — most email clients will strip these');
    }
  }

  // Subject line heuristics
  if (tpl.subject) {
    if (tpl.subject.length > 78) {
      warnings.push(`Subject is ${tpl.subject.length} chars — many clients truncate at 78`);
    }
    if (/[A-Z]{4,}/.test(tpl.subject)) {
      warnings.push('Subject contains ALL CAPS words — may trigger spam filters');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a list of targets for a campaign.
 * Returns { valid, errors[], validTargets[] }.
 */
function validateTargetList(targets) {
  const errors        = [];
  const validTargets  = [];
  const emailsSeen    = new Set();

  for (const [i, t] of targets.entries()) {
    const row = i + 1;

    if (!t.email?.trim()) {
      errors.push(`Row ${row}: missing email`);
      continue;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email.trim())) {
      errors.push(`Row ${row}: invalid email '${t.email}'`);
      continue;
    }

    const email = t.email.trim().toLowerCase();
    if (emailsSeen.has(email)) {
      errors.push(`Row ${row}: duplicate email '${email}'`);
      continue;
    }

    emailsSeen.add(email);
    validTargets.push({ ...t, email });
  }

  return { valid: errors.length === 0, errors, validTargets };
}

module.exports = { validate, validateTargetList };
