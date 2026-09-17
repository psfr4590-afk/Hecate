'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../db/database').get();

function addNode({ id, engagementId, type, value, label, metadata }) {
  db().prepare('INSERT OR IGNORE INTO target_graph_nodes (id,engagement_id,type,value,label,metadata) VALUES (?,?,?,?,?,?)')
    .run(id ?? randomUUID(), engagementId, type, value, label ?? null, metadata ? JSON.stringify(metadata) : null);
}

function addEdge({ sourceId, targetId, relation, weight }) {
  db().prepare('INSERT OR IGNORE INTO target_graph_edges (id,source_id,target_id,relation,weight) VALUES (?,?,?,?,?)')
    .run(randomUUID(), sourceId, targetId, relation, weight ?? 1.0);
}

function removeNode(nodeId) {
  db().prepare('DELETE FROM target_graph_edges WHERE source_id=? OR target_id=?').run(nodeId, nodeId);
  db().prepare('DELETE FROM target_graph_nodes WHERE id=?').run(nodeId);
}

function toD3(engagementId) {
  const nodes = db().prepare('SELECT * FROM target_graph_nodes WHERE engagement_id=?').all(engagementId)
    .map(n => ({ ...n, metadata: n.metadata ? JSON.parse(n.metadata) : {} }));
  const nodeIds = new Set(nodes.map(n => n.id));
  const links   = db().prepare(`
    SELECT e.* FROM target_graph_edges e
    JOIN target_graph_nodes s ON e.source_id=s.id
    WHERE s.engagement_id=?`).all(engagementId)
    .filter(e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
    .map(e => ({ source: e.source_id, target: e.target_id, relation: e.relation, weight: e.weight }));
  return { nodes, links };
}

function getNode(nodeId) {
  const row = db().prepare('SELECT * FROM target_graph_nodes WHERE id=?').get(nodeId);
  return row ? { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : {} } : null;
}

function getSubgraph(nodeId, depth = 2) {
  const visited = new Set([nodeId]);
  const queue   = [[nodeId, 0]];
  const edges   = [];

  while (queue.length) {
    const [cur, d] = queue.shift();
    if (d >= depth) continue;
    const outEdges = db().prepare('SELECT * FROM target_graph_edges WHERE source_id=?').all(cur);
    for (const e of outEdges) {
      edges.push(e);
      if (!visited.has(e.target_id)) { visited.add(e.target_id); queue.push([e.target_id, d + 1]); }
    }
  }

  const nodes = db().prepare(`SELECT * FROM target_graph_nodes WHERE id IN (${[...visited].map(() => '?').join(',')})`)
    .all(...visited);
  return { nodes, links: edges.map(e => ({ source: e.source_id, target: e.target_id, relation: e.relation })) };
}

function findPaths(fromId, toId) {
  // BFS path finding
  const queue  = [[fromId, [fromId]]];
  const found  = [];
  const visited = new Set();

  while (queue.length && found.length < 10) {
    const [cur, path] = queue.shift();
    if (cur === toId) { found.push(path); continue; }
    if (visited.has(cur) || path.length > 8) continue;
    visited.add(cur);
    const edges = db().prepare('SELECT target_id FROM target_graph_edges WHERE source_id=?').all(cur);
    for (const e of edges) queue.push([e.target_id, [...path, e.target_id]]);
  }
  return found;
}

module.exports = { addNode, addEdge, removeNode, getNode, toD3, getSubgraph, findPaths };
