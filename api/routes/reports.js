'use strict';

const { Router } = require('express');
const { requireEngagement } = require('../../core/auth/authorization');
const { HecateError } = require('../middleware/error-handler');
const { buildAssessmentReport, toMarkdown } = require('../../core/reporting/assessment-report');

const router = Router();

router.get('/engagement/:eid', (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);
    const report = buildAssessmentReport(eid);
    if (!report) throw new HecateError('HECATE_NOT_FOUND', 'Engagement not found');
    res.json({ report });
  } catch (err) { next(err); }
});

router.get('/engagement/:eid/markdown', (req, res, next) => {
  try {
    const eid = req.params.eid;
    requireEngagement(req, eid);
    const report = buildAssessmentReport(eid);
    if (!report) throw new HecateError('HECATE_NOT_FOUND', 'Engagement not found');
    res.type('text/markdown').send(toMarkdown(report));
  } catch (err) { next(err); }
});

module.exports = router;
