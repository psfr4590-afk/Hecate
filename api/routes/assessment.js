'use strict';
const { Router } = require('express');
const { requireEngagement } = require('../../core/auth/authorization');
const Assessment = require('../../core/assessment/assessment-manager');
const Finding = require('../../core/db/models/finding');
const Retest = require('../../core/assessment/retest-store');
const { HecateError } = require('../middleware/error-handler');

const router = Router();

router.get('/:eid/plan', (req,res,next) => {
  try { const eid=req.params.eid; requireEngagement(req,eid); res.json({ plan: Assessment.get(eid) }); } catch(err){ next(err); }
});
router.put('/:eid/plan', (req,res,next) => {
  try { const eid=req.params.eid; requireEngagement(req,eid); res.json({ plan: Assessment.save(eid,req.body ?? {}) }); } catch(err){ next(err); }
});
router.get('/:eid/findings/:fid/retests', (req,res,next) => {
  try { const eid=req.params.eid; requireEngagement(req,eid); if(!Finding.findByIdForEngagement(req.params.fid,eid)) throw new HecateError('HECATE_NOT_FOUND','Finding not found'); res.json({ retests: Retest.listForFinding(req.params.fid,eid) }); } catch(err){ next(err); }
});
router.post('/:eid/findings/:fid/retests', (req,res,next) => {
  try { const eid=req.params.eid; requireEngagement(req,eid); if(!Finding.findByIdForEngagement(req.params.fid,eid)) throw new HecateError('HECATE_NOT_FOUND','Finding not found'); res.status(201).json({ retest: Retest.create({engagementId:eid,findingId:req.params.fid,notes:req.body?.notes,evidenceId:req.body?.evidenceId}) }); } catch(err){ next(err); }
});
router.patch('/:eid/findings/:fid/retests/:rid', (req,res,next) => {
  try { const eid=req.params.eid; requireEngagement(req,eid); const retest=Retest.complete(req.params.rid,eid,req.body?.status,req.body?.notes); if(!retest) throw new HecateError('HECATE_NOT_FOUND','Retest not found'); res.json({ retest }); } catch(err){ next(err); }
});
router.patch('/:eid/findings/:fid', (req,res,next) => {
  try { const eid=req.params.eid; requireEngagement(req,eid); const finding=Finding.updateLifecycle(req.params.fid,eid,req.body ?? {}); if(!finding) throw new HecateError('HECATE_NOT_FOUND','Finding not found'); res.json({ finding }); } catch(err){ next(err); }
});
module.exports = router;
