export const demoStatus = { platform: 'HECATE', version: 'preview', uptime: 0, modules: ['recon','evil-proxy','c2','delivery','mitm','webapp','post-exploit'], clients: 0 };
export const demoEngagements = [{ id: 'preview-engagement', name: 'Preview Engagement', status: 'active', description: 'Local console preview' }];
export const demoTargets = [
  { id: 't-001', type: 'domain', value: 'example.local', label: 'Primary scope' },
  { id: 't-002', type: 'host', value: '10.10.10.21', label: 'Internal host' },
];
export const demoFindings = [
  { id: 'f-001', title: 'Preview finding', severity: 'high', module: 'webapp', status: 'open', target_id: 't-001' },
  { id: 'f-002', title: 'Configuration review', severity: 'medium', module: 'recon', status: 'open', target_id: 't-002' },
];
export const demoEvidence = [{ id: 'e-001', type: 'screenshot', module: 'webapp', label: 'Preview evidence', created_at: new Date().toISOString() }];
export const demoSessions = [{ id: 's-001', module: 'recon', status: 'active', transport: 'local', target_id: 't-001' }];
export const demoAudit = [{ id: 'a-001', action: 'preview', module: 'console', created_at: new Date().toISOString() }];
