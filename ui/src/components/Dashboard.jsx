function metric(label,value,sub){return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>}
function severityCounts(findings){return ['critical','high','medium','low','info'].map(s=>[s,findings.filter(f=>f.severity===s).length]);}
const moduleDescriptions = {
  c2: 'Command and control',
  delivery: 'Campaign delivery',
  'evil-proxy': 'Adversary-in-the-middle proxy',
  mitm: 'Network interception',
  'post-exploit': 'Post-exploitation',
  recon: 'Reconnaissance and discovery',
  webapp: 'Web application assessment',
};
export function Dashboard({ data, onNewEngagement, onNavigate, onVerify }) {
  const findings=data.findings??[], active=(data.sessions??[]).filter(s=>s.status==='active').length;
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
      <section className="panel panel--wide"><div className="panel-head"><div><span className="eyebrow">MODULES</span><h2>Platform surface</h2></div><span className="panel-hint">Select a ready module to open its operator controls.</span></div>
        <div className="module-grid">{(data.status?.modules || []).map(name=>{
          const safeName = String(name);
          const description = moduleDescriptions[safeName] || 'Registered module';
          return <button type="button" className="module-card" key={safeName} onClick={()=>onNavigate(`module:${safeName}`} )} aria-label={`Open ${safeName} module controls`}>
            <span className="module-glyph">◇</span><div><strong>{safeName}</strong><small>{description}</small></div><span className="module-state">READY</span>
          </button>;
        })}</div>
        {!(data.status?.modules || []).length && <div className="empty">No modules are registered with the local node.</div>}
      </section>
      <section className="panel panel--wide"><div className="panel-head"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Audit events</h2></div><button className="text-button" onClick={()=>onNavigate('audit')}>Open audit</button></div>
        <div className="activity-list">{(data.audit||[]).slice(0,8).map((a,i)=><div className="activity-row" key={a.id||i}><span className="activity-line" /><div><strong>{a.action || a.event || 'event'}</strong><small>{a.module || 'core'} · {a.operator_id || a.operatorId || 'operator'}</small></div><time>{formatTime(a.created_at || a.timestamp)}</time></div>)}{!(data.audit||[]).length&&<Empty text="No audit events available."/>}</div>
      </section>
    </div>
  </div>;
}
function formatTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.valueOf())?'—':d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function Empty({text}){return <div className="empty">{text}</div>}
