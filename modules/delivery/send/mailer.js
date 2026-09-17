'use strict';

/**
 * HECATE Delivery — Mailer
 * SMTP send wrapper. Supports multiple SMTP profiles (different servers
 * per campaign) and a dry-run mode for testing without sending.
 *
 * SMTP is handled via Node's built-in `net`/`tls` modules.
 * For production use, operators can configure a relay (SendGrid, Postfix, etc.).
 * Nodemailer is supported as an optional dep — detected at runtime.
 */

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* optional */ }

// Map<profileId, SmtpProfile>
const profiles = new Map();

let _dryRun   = false;
let _eventBus = null;

function setDryRun(v)   { _dryRun   = v; }
function setEventBus(b) { _eventBus = b; }

/**
 * Register an SMTP profile.
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.host
 * @param {number} p.port      — 587 (STARTTLS) or 465 (SSL) or 25
 * @param {boolean} p.secure   — true for 465
 * @param {string} p.user
 * @param {string} p.pass
 * @param {boolean} p.rejectUnauthorized — default true
 */
function addProfile(p) {
  if (!p.id)   throw new Error('SMTP profile requires id');
  if (!p.host) throw new Error('SMTP profile requires host');
  profiles.set(p.id, {
    id:   p.id,
    host: p.host,
    port: p.port ?? 587,
    secure: p.secure ?? (p.port === 465),
    auth: p.user ? { user: p.user, pass: p.pass ?? '' } : null,
    rejectUnauthorized: p.rejectUnauthorized ?? true,
  });
}

function removeProfile(id) { profiles.delete(id); }
function getProfile(id)    { return profiles.get(id) ?? null; }
function listProfiles()    { return [...profiles.values()].map(p => ({ ...p, auth: p.auth ? { user: p.auth.user } : null })); }

/**
 * Send an email.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.fromName
 * @param {string} opts.fromEmail
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} opts.text
 * @param {string} opts.smtpProfileId
 * @param {object} opts.headers      — additional headers (X-Mailer, etc.)
 */
async function send(opts) {
  const { to, fromName, fromEmail, subject, html, text, smtpProfileId, headers } = opts;

  if (_dryRun) {
    _eventBus?.emit('delivery:dry_run', { to, subject, ts: new Date().toISOString() });
    return { messageId: `dry-run-${Date.now()}`, accepted: [to] };
  }

  if (!nodemailer) {
    throw new Error('nodemailer not installed — run: npm install nodemailer');
  }

  const profile = smtpProfileId ? profiles.get(smtpProfileId) : null;
  if (smtpProfileId && !profile) {
    throw new Error(`SMTP profile not found: ${smtpProfileId}`);
  }

  const transport = nodemailer.createTransport(profile
    ? {
        host:   profile.host,
        port:   profile.port,
        secure: profile.secure,
        auth:   profile.auth,
        tls:    { rejectUnauthorized: profile.rejectUnauthorized },
      }
    : { sendmail: true }  // fallback: system sendmail
  );

  const result = await transport.sendMail({
    from:    fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
    to,
    subject,
    html:    html  ?? undefined,
    text:    text  ?? undefined,
    headers: {
      'X-Mailer': 'HECATE/1.0',
      ...headers,
    },
  });

  return result;
}

module.exports = {
  setDryRun, setEventBus,
  addProfile, removeProfile, getProfile, listProfiles,
  send,
};
