'use strict';

const { Router } = require('express');
const tracker = require('../tracking/tracker');

const router = Router();

// Public campaign tracking endpoints. This router is mounted outside the
// authenticated /api/v1 middleware because recipients do not possess an
// operator API token.
router.get('/open/:trackingId', (req, res) => {
  const r = tracker.handleOpen(req.params.trackingId, {
    ip: req.ip, ua: req.headers['user-agent']
  });
  res.set(r.headers ?? {}).status(r.status).send(r.body);
});

router.get('/click/:trackingId/:linkId', (req, res) => {
  const dest = req.query.u ? decodeURIComponent(req.query.u) : '/';
  const r = tracker.handleClick(req.params.trackingId, req.params.linkId, dest, {
    ip: req.ip, ua: req.headers['user-agent']
  });
  res.redirect(r.status, r.redirect);
});

router.post('/submit/:trackingId', (req, res) => {
  const r = tracker.handleSubmit(req.params.trackingId, req.body ?? {}, {
    ip: req.ip, ua: req.headers['user-agent']
  });
  res.status(r.status).type(r.contentType).send(r.body);
});

module.exports = router;
