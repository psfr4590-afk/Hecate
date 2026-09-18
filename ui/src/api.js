const BASE = '/api/v1';

async function request(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: { message: text } }; }
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

const q = value => encodeURIComponent(value);

export const api = {
  logout: () => request('/session/logout', { method: 'POST' }),
  status: () => request('/status'),
  engagements: () => request('/engagements'),
  createEngagement: payload => request('/engagements', { method: 'POST', body: JSON.stringify(payload) }),
  targets: eid => request(`/targets/engagement/${q(eid)}`),
  findings: eid => request(`/findings/engagement/${q(eid)}`),
  evidence: eid => request(`/evidence/engagement/${q(eid)}`),
  sessions: eid => request(`/sessions/engagement/${q(eid)}`),
  audit: eid => request(`/audit?engagementId=${q(eid)}&limit=50`),
  verifyAudit: () => request('/audit/verify'),

  startRecon: payload => request('/recon/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  reconJob: id => request(`/recon/jobs/${q(id)}`),
  cancelRecon: id => request(`/recon/jobs/${q(id)}`, { method: 'DELETE' }),
  startWebappScan: payload => request('/webapp/scans', { method: 'POST', body: JSON.stringify(payload) }),
  webappScan: id => request(`/webapp/scans/${q(id)}`),
  cancelWebappScan: id => request(`/webapp/scans/${q(id)}`, { method: 'DELETE' }),

  c2Implants: eid => request(`/c2/implants?eid=${q(eid)}`),
  c2Stats: eid => request(`/c2/implants/stats?eid=${q(eid)}`),
  c2Profiles: eid => request(`/c2/profiles?eid=${q(eid)}`),
  createC2Profile: payload => request('/c2/profiles', { method:'POST', body:JSON.stringify(payload) }),
  registerC2Implant: payload => request('/c2/implants', { method:'POST', body:JSON.stringify(payload) }),
  c2Tasks: id => request(`/c2/implants/${q(id)}/tasks`),
  queueC2Task: (id,payload) => request(`/c2/implants/${q(id)}/tasks`, { method:'POST', body:JSON.stringify(payload) }),
  cancelC2Task: (id,taskId) => request(`/c2/implants/${q(id)}/tasks/${q(taskId)}`, { method:'DELETE' }),
  c2Results: id => request(`/c2/implants/${q(id)}/results?limit=50`),
  killC2Implant: id => request(`/c2/implants/${q(id)}`, { method:'DELETE' }),

  deliveryCampaigns: eid => request(`/delivery/campaigns?eid=${q(eid)}`),
  createDeliveryCampaign: payload => request('/delivery/campaigns', { method:'POST', body:JSON.stringify(payload) }),
  deliveryCampaign: id => request(`/delivery/campaigns/${q(id)}`),
  deliveryStats: id => request(`/delivery/campaigns/${q(id)}/stats`),
  deliveryTargets: id => request(`/delivery/campaigns/${q(id)}/targets`),
  addDeliveryTargets: (id,payload) => request(`/delivery/campaigns/${q(id)}/targets`, { method:'POST', body:JSON.stringify(payload) }),
  transitionDelivery: (id,state) => request(`/delivery/campaigns/${q(id)}/state`, { method:'POST', body:JSON.stringify({state}) }),
  deleteDeliveryCampaign: id => request(`/delivery/campaigns/${q(id)}`, { method:'DELETE' }),
  deliverySmtp: eid => request(`/delivery/smtp?eid=${q(eid)}`),
  addDeliverySmtp: payload => request('/delivery/smtp', { method:'POST', body:JSON.stringify(payload) }),
  deleteDeliverySmtp: (id,eid) => request(`/delivery/smtp/${q(id)}?eid=${q(eid)}`, { method:'DELETE' }),

  evilLures: eid => request(`/evil-proxy/lures?eid=${q(eid)}`),
  evilPhishlets: () => request('/evil-proxy/phishlets'),
  createEvilLure: payload => request('/evil-proxy/lures', { method:'POST', body:JSON.stringify(payload) }),
  disableEvilLure: id => request(`/evil-proxy/lures/${q(id)}`, { method:'DELETE' }),
  evilSessions: eid => request(`/evil-proxy/sessions?eid=${q(eid)}`),
  evilSession: (lureId,victimSid) => request(`/evil-proxy/sessions/${q(lureId)}/${q(victimSid)}`),
  exportEvilSession: (lureId,victimSid) => request(`/evil-proxy/sessions/${q(lureId)}/${q(victimSid)}/export`),

  mitmSessions: eid => request(`/mitm/sessions?eid=${q(eid)}`),
  createMitmSession: payload => request('/mitm/sessions', { method:'POST', body:JSON.stringify(payload) }),
  stopMitmSession: id => request(`/mitm/sessions/${q(id)}`, { method:'DELETE' }),
  mitmExchanges: eid => request(`/mitm/exchanges?eid=${q(eid)}&limit=100`),
  mitmCredentials: eid => request(`/mitm/credentials?eid=${q(eid)}`),
  mitmDnsRules: eid => request(`/mitm/dns/rules?eid=${q(eid)}`),
  addMitmDnsRule: payload => request('/mitm/dns/rules', { method:'POST', body:JSON.stringify(payload) }),
  deleteMitmDnsRule: (hostname,sessionId) => request(`/mitm/dns/rules/${q(hostname)}?session=${q(sessionId)}`, { method:'DELETE' }),
  startMitmDns: payload => request('/mitm/dns/start', { method:'POST', body:JSON.stringify(payload) }),
  stopMitmDns: payload => request('/mitm/dns/stop', { method:'POST', body:JSON.stringify(payload) }),
  mitmConfig: eid => request(`/mitm/config?eid=${q(eid)}`),
  updateMitmConfig: payload => request('/mitm/config', { method:'PATCH', body:JSON.stringify(payload) }),
  mitmStats: eid => request(`/mitm/stats?eid=${q(eid)}`),

  postHashes: eid => request(`/post-exploit/hashes?eid=${q(eid)}`),
  ingestHashes: payload => request('/post-exploit/hashes', { method:'POST', body:JSON.stringify(payload) }),
  crackHash: (id,plaintext) => request(`/post-exploit/hashes/${q(id)}/cracked`, { method:'PATCH', body:JSON.stringify({plaintext}) }),
  kerberoastTargets: eid => request(`/post-exploit/kerberoast/targets?eid=${q(eid)}`),
  queueKerberoast: payload => request('/post-exploit/kerberoast/queue', { method:'POST', body:JSON.stringify(payload) }),
  pivotSurface: eid => request(`/post-exploit/pivot/surface?eid=${q(eid)}`),
  pivotPaths: eid => request(`/post-exploit/pivot/paths?eid=${q(eid)}`),
  computePivotPaths: payload => request('/post-exploit/pivot/paths', { method:'POST', body:JSON.stringify(payload) }),
  kerberoastable: eid => request(`/post-exploit/pivot/kerberoastable?eid=${q(eid)}`),
  asreproastable: eid => request(`/post-exploit/pivot/asreproastable?eid=${q(eid)}`),
  queueDump: payload => request('/post-exploit/dump', { method:'POST', body:JSON.stringify(payload) }),
  parseDump: payload => request('/post-exploit/dump/parse', { method:'POST', body:JSON.stringify(payload) }),
  postStats: eid => request(`/post-exploit/stats?eid=${q(eid)}`),
};
