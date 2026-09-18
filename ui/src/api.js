const BASE = '/api/v1';

async function request(path, token, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: { message: text } }; }
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

export const api = {
  logout: () => request('/session/logout', undefined, { method: 'POST' }),
  status: token => request('/status', token),
  engagements: token => request('/engagements', token),
  createEngagement: (payload, token) => request('/engagements', token, { method: 'POST', body: JSON.stringify(payload) }),
  targets: (eid, token) => request(`/targets/engagement/${encodeURIComponent(eid)}`, token),
  findings: (eid, token) => request(`/findings/engagement/${encodeURIComponent(eid)}`, token),
  evidence: (eid, token) => request(`/evidence/engagement/${encodeURIComponent(eid)}`, token),
  sessions: (eid, token) => request(`/sessions/engagement/${encodeURIComponent(eid)}`, token),
  audit: (eid, token) => request(`/audit?engagementId=${encodeURIComponent(eid)}&limit=50`, token),
  verifyAudit: token => request('/audit/verify', token),
};

const KEY = 'hecate.api.token';
export const getSavedToken = () => sessionStorage.getItem(KEY) || '';
export const saveToken = token => token ? sessionStorage.setItem(KEY, token) : sessionStorage.removeItem(KEY);
