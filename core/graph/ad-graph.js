'use strict';
const { randomUUID } = require('crypto');
const db = () => require('../db/database').get();

// ── Node/Edge management ──────────────────────────────────────────────────────

function upsertNode({ id, engagementId, name, type, domain, adminCount, kerberoastable, asrepRoastable, spns, metadata }) {
  const nid = id ?? randomUUID();
  db().prepare(`INSERT INTO ad_graph_nodes
    (id,engagement_id,name,type,domain,admin_count,kerberoastable,asrep_roastable,spns,metadata)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, admin_count=excluded.admin_count,
      kerberoastable=excluded.kerberoastable, asrep_roastable=excluded.asrep_roastable,
      spns=excluded.spns, metadata=excluded.metadata`).run(
    nid, engagementId, name ?? null, type, domain ?? null,
    adminCount ? 1 : 0, kerberoastable ? 1 : 0, asrepRoastable ? 1 : 0,
    spns ? JSON.stringify(spns) : null,
    metadata ? JSON.stringify(metadata) : null);
  return nid;
}

function addEdge({ engagementId, sourceId, targetId, relation }) {
  db().prepare('INSERT OR IGNORE INTO ad_graph_edges (id,engagement_id,source_id,target_id,relation) VALUES (?,?,?,?,?)')
    .run(randomUUID(), engagementId, sourceId, targetId, relation);
}

// ── Queries ───────────────────────────────────────────────────────────────────

function toD3(engagementId) {
  const nodes = db().prepare('SELECT * FROM ad_graph_nodes WHERE engagement_id=?').all(engagementId)
    .map(n => ({ ...n, spns: n.spns ? JSON.parse(n.spns) : [], adminCount: !!n.admin_count,
                 kerberoastable: !!n.kerberoastable, asrepRoastable: !!n.asrep_roastable }));
  const links = db().prepare('SELECT * FROM ad_graph_edges WHERE engagement_id=?').all(engagementId)
    .map(e => ({ source: e.source_id, target: e.target_id, relation: e.relation }));
  return { nodes, links };
}

function findKerberoastable(engagementId) {
  return db().prepare('SELECT * FROM ad_graph_nodes WHERE engagement_id=? AND kerberoastable=1').all(engagementId)
    .map(n => ({ ...n, spns: n.spns ? JSON.parse(n.spns) : [] }));
}

function findAsrepRoastable(engagementId) {
  return db().prepare('SELECT * FROM ad_graph_nodes WHERE engagement_id=? AND asrep_roastable=1').all(engagementId);
}

function findDomainAdmins(engagementId) {
  return db().prepare("SELECT * FROM ad_graph_nodes WHERE engagement_id=? AND (type='domain-admin' OR admin_count=1)").all(engagementId);
}

function findDomainAdminPaths(engagementId, fromId) {
  const daIds = findDomainAdmins(engagementId).map(n => n.id);
  if (!daIds.length) return [];

  // BFS from fromId toward any DA node
  const adj = _buildAdj(engagementId);
  const paths = [];
  const queue = [[fromId, [fromId]]];
  const visited = new Set();

  while (queue.length && paths.length < 10) {
    const [cur, path] = queue.shift();
    if (daIds.includes(cur) && path.length > 1) { paths.push(path); continue; }
    if (visited.has(cur) || path.length > 8) continue;
    visited.add(cur);
    for (const next of (adj.get(cur) ?? [])) {
      if (!path.includes(next)) queue.push([next, [...path, next]]);
    }
  }
  return paths;
}

function _buildAdj(engagementId) {
  const adj = new Map();
  const edges = db().prepare('SELECT source_id, target_id FROM ad_graph_edges WHERE engagement_id=?').all(engagementId);
  for (const e of edges) {
    if (!adj.has(e.source_id)) adj.set(e.source_id, []);
    adj.get(e.source_id).push(e.target_id);
  }
  return adj;
}

// ── BloodHound JSON ingest ────────────────────────────────────────────────────

function ingest(engagementId, data) {
  let users = 0; let groups = 0; let computers = 0; let edges = 0;

  const process = (items, type) => {
    for (const item of items ?? []) {
      const props = item.Properties ?? item;
      const id = item.ObjectIdentifier ?? randomUUID();
      upsertNode({
        id, engagementId, type,
        name:            props.name ?? props.Name,
        domain:          props.domain ?? props.Domain,
        adminCount:      props.admincount ?? props.AdminCount,
        kerberoastable:  props.hasspn ?? props.HasSPN,
        asrepRoastable:  props.dontreqpreauth ?? props.DontRequirePreAuth,
        spns:            props.serviceprincipalnames ?? props.ServicePrincipalNames,
      });
      if (type === 'user')     users++;
      if (type === 'group')    groups++;
      if (type === 'computer') computers++;

      for (const ace of item.Aces ?? []) {
        addEdge({ engagementId, sourceId: ace.PrincipalSID ?? randomUUID(), targetId: id, relation: ace.RightName ?? 'Unknown' });
        edges++;
      }
    }
  };

  // BloodHound v4/v5 format
  if (data.users)     process(data.users,     'user');
  if (data.groups)    process(data.groups,    'group');
  if (data.computers) process(data.computers, 'computer');
  if (data.gpos)      process(data.gpos,      'gpo');

  // Relationship arrays
  for (const rel of data.relationships ?? []) {
    addEdge({ engagementId, sourceId: rel.SourceSID ?? rel.source, targetId: rel.DestSID ?? rel.target, relation: rel.RelationshipKind ?? rel.relation });
    edges++;
  }

  return { users, groups, computers, edges };
}

module.exports = { upsertNode, addEdge, toD3, findKerberoastable, findAsrepRoastable, findDomainAdmins, findDomainAdminPaths, ingest };
