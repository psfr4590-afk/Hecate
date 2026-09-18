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

export const api = {
  logout: () => request('/session/logout', { method: 'POST' }),
  status: () => request('/status'),
  engagements: () => request('/engagements'),
  createEngagement: payload => request('/engagements', { method: 'POST', body: JSON.stringify(payload) }),
  targets: eid => request(`/targets/engagement/${encodeURIComponent(eid)}`),
  findings: eid => request(`/findings/engagement/${encodeURIComponent(eid)}`),
  evidence: eid => request(`/evidence/engagement/${encodeURIComponent(eid)}`),
  sessions: eid => request(`/sessions/engagement/${encodeURIComponent(eid)}`),
  audit: eid => request(`/audit?engagementId=${encodeURIComponent(eid)}&limit=50`),
  verifyAudit: () => request('/audit/verify'),

  // Operator launch controls for assessment-safe modules.
  startRecon: payload => request('/recon/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  reconJob: id => request(`/recon/jobs/${encodeURIComponent(id)}`),
  cancelRecon: id => request(`/recon/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  startWebappScan: payload => request('/webapp/scans', { method: 'POST', body: JSON.stringify(payload) }),
  webappScan: id => request(`/webapp/scans/${encodeURIComponent(id)}`),
  cancelWebappScan: id => request(`/webapp/scans/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
