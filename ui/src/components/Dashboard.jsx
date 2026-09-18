function metric(label,value,sub){return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>}
function severityCounts(findings){return ['critical','high','medium','low','info'].map(s=>[s,findings.filter(f=>f.severity===s).length]);}
const moduleDescriptions = {
  c2: 'Command and control',
  delivery: 'Campaign delivery and tracking',
  'evil-proxy': 'Adversary-in-the-middle proxy',
  mitm: 'Network interception and traffic capture',
  'post-exploit': 'Credential analysis and lateral movement planning',
  recon: 'Reconnaissance and discovery',
  webapp: 'Web application assessment',
};

const moduleCapabilities = {
  recon: ['Scoped web crawling', 'Page and asset discovery', 'Evidence and secret discovery', 'Job cancellation'],
  webapp: ['Web application scans', 'Finding generation', 'Target-scoped execution', 'Scan cancellation'],
  c2: ['Implant registration', 'Task queueing', 'Beacon handling', 'Task results'],
  delivery: ['Campaign management', 'Target import', 'Campaign state control', 'Open/click tracking'],
  'evil-proxy': ['Phishing lures', 'Victim session tracking', 'Session export', 'Phishlet-backed proxying'],
  mitm: ['DNS rules', 'DNS service control', 'Intercepted traffic', 'Credential capture records'],
  'post-exploit': ['Hash ingestion', 'Kerberoast task queueing', 'AD attack-path planning', 'Secrets-dump task queueing'],
};

const coreCapabilities = [
  ['Engagements', 'Scope and lifecycle context', 'engagements'],
  ['Targets', 'Asset inventory and search', 'targets'],
  ['Evidence', 'Collected assessment records', 'evidence'],
  ['Findings', 'Vulnerability and observation records', 'findings'],
  ['Sessions', 'Module session tracking', 'sessions'],
  ['Audit', 'Append-only operator history', 'audit'],
];
export function Dashboard({ data, onNewEngagement, onNavigate, onVerify }) {
  const findings=data.findings??[], active=(data.sessions??[]).filter(s=>s.status==='active').length;
  const registeredModules=(data.status?.modules || []).map(String);
  return <div className="page">
    <div className="page-intro"><div><span className="eyebrow">OPERATOR WORKSPACE</span><h1>{data.engagement?.name ?? 'No engagement selected'}</h1><p>{data.engagement?.description || 'Local-first security operations and evidence management.'}</p></div><button className="button button--silver" onClick={onNewEngagement}>＋ New engagement</button></div>
    <section className="metrics">{metric('Targets',data.targets.length,'in current scope')}{metric('Active sessions',active,'live module sessions')}{metric('Findings',findings.length,'recorded findings')}{metric('Evidence',data.evidence.length,'captured records')}</section>
    <div className="dashboard-grid">
      <section className="panel panel--large"><div className="panel-head"><div><span className="eyebrow">FINDINGS</span><h2>Risk picture</h2></div><button className="text-button" onClick={()=>onNavigate('findings')}>View all</button></div>
        <div className="severity-grid">{severityCounts(findings).map(([s,n])=><div className={`severity-card severity--${s}`} key={s}><span>{s}</span><strong>{n}</strong></div>)}</div>
        <div className="finding-list">{findings.slice(0,5).map(f=><div className="finding-row" key={f.id}><span className={`severity-dot severity-dot--${f.severity}`} /><div><strong>{f.title}</strong><small>{f.module || 'core'} · {f.target_id || f.targetId || 'unscoped'}</small></div><span className="row-status">{f.status || 'open'}</span></div>)}{!findings.length&&<Empty text="No findings recorded for this engagement."/>}</div>
      </section>
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">INTEGRITY</span><h2>Audit chain</h2></div><button className="text-button" onClick={onVerify}>Verify</button></div>
        <div className={`integrity integrity--${data.integrity?.state || 'unverified'}`}><div className="integrity-orb" /><strong>{data.integrity?.state === 'valid' ? 'CHAIN VERIFIED' : data.integrity?.state === 'invalid' ? 'VERIFICATION FAILED' : 'UNVERIFIED'}</strong><span>{data.integrity?.tip || 'Verification has not been run.'}</span></div>
      </section>
      <section className="panel panel--wide"><div className="panel-head"><div><span className="eyebrow">CAPABILITY MAP</span><h2>Full operator surface</h2></div><span className="panel-hint">{registeredModules.length} registered modules · {coreCapabilities.length} core workspaces</span></div>
        <div className="capability-grid">
          <div className="capability-group">
            <div className="capability-group-head"><span className="eyebrow">CORE CONTROL PLANE</span><strong>Assessment foundation</strong></div>
            <div className="capability-list">{coreCapabilities.map(([label,description,view])=><button type="button" className="capability-row" key={view} onClick={()=>onNavigate(view)}><span className="capability-icon">◇</span><span><strong>{label}</strong><small>{description}</small></span><span className="capability-open">OPEN</span></button>)}</div>
          </div>
          <div className="capability-group">
            <div className="capability-group-head"><span className="eyebrow">MODULES</span><strong>Execution capabilities</strong></div>
            <div className="capability-list">{registeredModules.map(name=>{
              const capabilities=moduleCapabilities[name] || ['Registered API capability'];
              return <button type="button" className="capability-row capability-row--module" key={name} onClick={()=>onNavigate(`module:${name}`)} aria-label={`Open ${name} capability surface`}>
                <span className="capability-icon">◇</span><span><strong>{name}</strong><small>{moduleDescriptions[name] || 'Registered module'} · {capabilities.length} capabilities</small></span><span className="capability-open">OPEN</span>
              </button>;
            })}</div>
          </div>
        </div>
      </section>

      <section className="panel panel--wide"><div className="panel-head"><div><span className="eyebrow">MODULE DETAIL</span><h2>Capability inventory</h2></div><span className="panel-hint">Select a module to inspect its exposed workflow surface.</span></div>
        <div className="module-grid">{registeredModules.map(name=>{
          const capabilities=moduleCapabilities[name] || ['Registered API capability'];
          return <button type="button" className="module-card" key={name} onClick={()=>onNavigate(`module:${name}`)} aria-label={`Open ${name} module controls`}>
            <span className="module-glyph">◇</span><div><strong>{name}</strong><small>{moduleDescriptions[name] || 'Registered module'}</small><small>{capabilities.slice(0,2).join(' · ')}</small></div><span className="module-state">{capabilities.length} CAP.</span>
          </button>;
        })}</div>
        {!registeredModules.length && <div className="empty">No modules are registered with the local node.</div>}
      </section>
      <section className="panel panel--wide"><div className="panel-head"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Audit events</h2></div><button className="text-button" onClick={()=>onNavigate('audit')}>Open audit</button></div>
        <div className="activity-list">{(data.audit||[]).slice(0,8).map((a,i)=><div className="activity-row" key={a.id||i}><span className="activity-line" /><div><strong>{a.action || a.event || 'event'}</strong><small>{a.module || 'core'} · {a.operator_id || a.operatorId || 'operator'}</small></div><time>{formatTime(a.created_at || a.timestamp)}</time></div>)}{!(data.audit||[]).length&&<Empty text="No audit events available."/>}</div>
      </section>
    </div>
  </div>;
}
function formatTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.valueOf())?'—':d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function Empty({text}){return <div className="empty">{text}</div>}
