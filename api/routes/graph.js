'use strict';

const { Router }      = require('express');
const TargetGraph     = require('../../core/graph/target-graph');
const ADGraph         = require('../../core/graph/ad-graph');
const { HecateError } = require('../middleware/error-handler');
const { requireEngagement, requireResource } = require('../../core/auth/authorization');

const router = Router();

// ── Target Graph ─────────────────────────────────────────────────────────────

// GET /graph/targets/:eid — full D3-ready graph for an engagement
router.get('/targets/:eid', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const graph = TargetGraph.toD3(req.params.eid);
    res.json(graph);
  } catch (err) { next(err); }
});

// GET /graph/targets/:eid/node/:nodeId?depth=2
router.get('/targets/:eid/node/:nodeId', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const node = TargetGraph.getNode?.(req.params.nodeId);
    if (node) requireResource(req, node, 'Graph node');
    const depth = parseInt(req.query.depth ?? '2', 10);
    const sub   = TargetGraph.getSubgraph(req.params.nodeId, depth);
    res.json(sub);
  } catch (err) { next(err); }
});

// GET /graph/targets/:eid/paths?from=&to=
router.get('/targets/:eid/paths', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const { from, to } = req.query;
    if (!from || !to) {
      throw new HecateError('HECATE_BAD_INPUT', 'from and to node IDs required');
    }
    const source = TargetGraph.getNode?.(from);
    const target = TargetGraph.getNode?.(to);
    requireResource(req, source, 'Graph source node');
    requireResource(req, target, 'Graph target node');
    if (source.engagement_id !== target.engagement_id) {
      throw new HecateError('HECATE_FORBIDDEN', 'Cross-engagement graph path denied');
    }
    const paths = TargetGraph.findPaths(from, to);
    res.json({ paths, count: paths.length });
  } catch (err) { next(err); }
});

// POST /graph/targets/node — add node
router.post('/targets/node', async (req, res, next) => {
  try {
    const { id, engagementId, type, value, label, metadata } = req.body ?? {};
    if (!id || !engagementId || !type || !value) {
      throw new HecateError('HECATE_BAD_INPUT', 'id, engagementId, type, value required');
    }
    requireEngagement(req, engagementId);
    TargetGraph.addNode({ id, engagementId, type, value, label, metadata });
    res.status(201).json({ ok: true, id });
  } catch (err) { next(err); }
});

// POST /graph/targets/edge — add edge
router.post('/targets/edge', async (req, res, next) => {
  try {
    const { sourceId, targetId, relation, weight } = req.body ?? {};
    if (!sourceId || !targetId || !relation) {
      throw new HecateError('HECATE_BAD_INPUT', 'sourceId, targetId, relation required');
    }
    const source = TargetGraph.getNode?.(sourceId);
    const target = TargetGraph.getNode?.(targetId);
    requireResource(req, source, 'Graph source node');
    requireResource(req, target, 'Graph target node');
    if (source.engagement_id !== target.engagement_id) throw new HecateError('HECATE_FORBIDDEN', 'Cross-engagement graph edge denied');
    TargetGraph.addEdge({ sourceId, targetId, relation, weight });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /graph/targets/node/:nodeId
router.delete('/targets/node/:nodeId', async (req, res, next) => {
  try {
    const node = TargetGraph.getNode?.(req.params.nodeId);
    requireResource(req, node, 'Graph node');
    TargetGraph.removeNode(req.params.nodeId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── AD Graph ─────────────────────────────────────────────────────────────────

// GET /graph/ad/:eid — full AD graph D3
router.get('/ad/:eid', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const graph = ADGraph.toD3(req.params.eid);
    res.json(graph);
  } catch (err) { next(err); }
});

// GET /graph/ad/:eid/da-paths — domain admin attack paths
router.get('/ad/:eid/da-paths', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const { from } = req.query;
    if (!from) throw new HecateError('HECATE_BAD_INPUT', 'from node ID required');
    const paths = ADGraph.findDomainAdminPaths(req.params.eid, from);
    res.json({ paths, count: paths.length });
  } catch (err) { next(err); }
});

// GET /graph/ad/:eid/kerberoastable
router.get('/ad/:eid/kerberoastable', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const nodes = ADGraph.findKerberoastable(req.params.eid);
    res.json({ targets: nodes, count: nodes.length });
  } catch (err) { next(err); }
});

// GET /graph/ad/:eid/asreproastable
router.get('/ad/:eid/asreproastable', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const nodes = ADGraph.findAsrepRoastable(req.params.eid);
    res.json({ targets: nodes, count: nodes.length });
  } catch (err) { next(err); }
});

// GET /graph/ad/:eid/domain-admins
router.get('/ad/:eid/domain-admins', async (req, res, next) => {
  try {
    requireEngagement(req, req.params.eid);
    const nodes = ADGraph.findDomainAdmins(req.params.eid);
    res.json({ admins: nodes, count: nodes.length });
  } catch (err) { next(err); }
});

// POST /graph/ad/ingest — ingest BloodHound JSON
router.post('/ad/ingest', async (req, res, next) => {
  try {
    const { engagementId, data } = req.body ?? {};
    if (!engagementId || !data) {
      throw new HecateError('HECATE_BAD_INPUT', 'engagementId and data required');
    }
    requireEngagement(req, engagementId);
    const stats = ADGraph.ingest(engagementId, data);
    res.json({ ok: true, stats });
  } catch (err) { next(err); }
});

module.exports = router;
