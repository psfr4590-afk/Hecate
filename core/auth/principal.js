'use strict';

/** Immutable process principal. Authentication maps the configured API token to
 * exactly one operator identity for the lifetime of this HECATE process. */
const configured = String(process.env.HECATE_OPERATOR_ID || 'local-operator').trim();
if (!/^[A-Za-z0-9._:-]{1,128}$/.test(configured)) {
  throw new Error('HECATE_OPERATOR_ID contains invalid characters');
}
const OPERATOR_ID = configured;
function operatorId() { return OPERATOR_ID; }
module.exports = { OPERATOR_ID, operatorId };
