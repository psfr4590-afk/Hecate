import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Dashboard } from './components/Dashboard';
import { Workspace } from './components/Workspace';
import { ConnectionDialog, NewEngagementDialog, SearchDialog } from './components/Dialogs';
import { demoAudit, demoEngagements, demoEvidence, demoFindings, demoSessions, demoStatus, demoTargets } from './demoData';

const previewData = {
  status: demoStatus, engagements: demoEngagements, targets: demoTargets, findings: demoFindings,
  evidence: demoEvidence, sessions: demoSessions, audit: demoAudit,
  integrity: { state: 'unverified', hash: 'Preview data', tip: 'Not verified' },
};

export function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [newEngagementOpen, setNewEngagementOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [createError, setCreateError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState(previewData);
  const [activeEngagementId, setActiveEngagementId] = useState(previewData.engagements[0].id);

  const activeEngagement = useMemo(
    () => data.engagements.find(item => item.id === activeEngagementId) ?? data.engagements[0] ?? null,
    [data.engagements, activeEngagementId],
  );

  const loadEngagement = useCallback(async (engagementId) => {
    const [status, engagementsPayload, targets, findings, evidence, sessions, audit] = await Promise.all([
      api.status(), api.engagements(), api.targets(engagementId),
      api.findings(engagementId), api.evidence(engagementId),
      api.sessions(engagementId), api.audit(engagementId),
    ]);
    setData(current => ({
      ...current, status, engagements: engagementsPayload.engagements ?? [],
      targets: targets.targets ?? [], findings: findings.findings ?? [], evidence: evidence.evidence ?? [],
      sessions: sessions.sessions ?? [], audit: audit.entries ?? [],
      integrity: { state: 'unverified', hash: 'Awaiting verification', tip: 'Run verification' },
    }));
  }, []);

  const connect = useCallback(async () => {
    setConnectionError('');
    try {
      const [status, engagementsPayload] = await Promise.all([api.status(), api.engagements()]);
      const engagements = engagementsPayload.engagements ?? [];
      setConnected(true);
      if (!engagements.length) {
        setData(current => ({ ...current, status, engagements: [], targets: [], findings: [], evidence: [], sessions: [], audit: [], integrity: { state: 'unverified', hash: 'No engagement', tip: 'Create an engagement' } }));
        setConnectionOpen(false); setNewEngagementOpen(true); return;
      }
      const selected = engagements.some(item => item.id === activeEngagementId) ? activeEngagementId : engagements[0].id;
      setActiveEngagementId(selected);
      await loadEngagement(selected);
      setConnectionOpen(false);
    } catch (error) {
      setConnected(false);
      setConnectionError(error.message ?? 'Unable to connect to the local node.');
    }
  }, [activeEngagementId, loadEngagement]);

  const disconnect = () => {
    setConnected(false); setData(previewData);
    setActiveEngagementId(previewData.engagements[0].id); setConnectionOpen(false);
  };

  const changeEngagement = async id => {
    setActiveEngagementId(id);
    if (!connected) return;
    try { await loadEngagement(id); }
    catch (error) { setConnectionError(error.message); setConnectionOpen(true); }
  };

  const createEngagement = async event => {
    event.preventDefault();
    if (!connected) { setNewEngagementOpen(false); setConnectionOpen(true); return; }
    setSubmitting(true); setCreateError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api.createEngagement({ ...values, status: 'active' });
      const nextId = result.engagement.id;
      setActiveEngagementId(nextId); setNewEngagementOpen(false); await loadEngagement(nextId);
    } catch (error) { setCreateError(error.message); } finally { setSubmitting(false); }
  };

  const verifyIntegrity = async () => {
    if (!connected) { setConnectionOpen(true); return; }
    try {
      const result = await api.verifyAudit();
      setData(current => ({ ...current, integrity: {
        state: result.valid ? 'valid' : 'invalid',
        hash: result.hash ?? result.lastHash ?? 'Verified',
        tip: result.tip ?? result.chainTip ?? 'Chain intact',
      }}));
    } catch (error) {
      setData(current => ({ ...current, integrity: { state: 'invalid', hash: error.message, tip: 'Verification failed' } }));
    }
  };

  useEffect(() => {
    const handleKey = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); }
      if (event.key === 'Escape') { setSearchOpen(false); setConnectionOpen(false); setNewEngagementOpen(false); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => { connect(); }, [connect]);

  const viewData = { ...data, engagement: activeEngagement };

  return <div className="app-shell">
    <div className="ambient ambient--one" /><div className="ambient ambient--two" />
    <Sidebar activeView={activeView} onNavigate={setActiveView} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <div className="app-main">
      <Topbar engagement={activeEngagement} engagements={data.engagements} onEngagementChange={changeEngagement} connected={connected} onConnect={() => setConnectionOpen(true)} onMenu={() => setMobileOpen(true)} onSearch={() => setSearchOpen(true)} />
      <main className="content">
        {!connected && <button className="preview-banner" onClick={() => setConnectionOpen(true)}><strong>PREVIEW MODE</strong><span>Connect the local node for live operation data.</span></button>}
        {activeView === 'dashboard'
          ? <Dashboard data={viewData} onNewEngagement={() => setNewEngagementOpen(true)} onNavigate={setActiveView} onVerify={verifyIntegrity} />
          : <Workspace view={activeView} data={viewData} onNewEngagement={() => setNewEngagementOpen(true)} />}
      </main>
    </div>
    <ConnectionDialog open={connectionOpen} onConnect={connect} onDisconnect={disconnect} connected={connected} error={connectionError} onClose={() => setConnectionOpen(false)} />
    <NewEngagementDialog open={newEngagementOpen} onClose={() => setNewEngagementOpen(false)} onCreate={createEngagement} submitting={submitting} error={createError} />
    <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={setActiveView} data={viewData} />
  </div>;
}
