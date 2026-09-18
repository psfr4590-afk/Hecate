import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const configs={
  engagements:{title:'Engagements',eyebrow:'SCOPE',fields:[['name','Name'],['status','Status'],['scope','Scope'],['description','Description']]},
  targets:{title:'Targets',eyebrow:'SCOPE',fields:[['type','Type'],['value','Value'],['label','Label']]},
  findings:{title:'Findings',eyebrow:'RISK',fields:[['severity','Severity'],['title','Title'],['module','Module'],['status','Status']]},
  evidence:{title:'Evidence',eyebrow:'COLLECTION',fields:[['type','Type'],['module','Module'],['label','Label']]},
  sessions:{title:'Sessions',eyebrow:'OPERATIONS',fields:[['module','Module'],['status','Status'],['transport','Transport']]},
  audit:{title:'Audit Log',eyebrow:'INTEGRITY',fields:[['action','Action'],['module','Module'],['created_at','Timestamp']]},
};

const moduleInfo = {
  recon: { title:'Reconnaissance', eyebrow:'MODULE · RECON', description:'Scoped reconnaissance and discovery against an authorized target.', capabilities:['Scoped web crawling','Page and asset discovery','Evidence and secret discovery','Job cancellation'], routes:['POST /recon/jobs','GET /recon/jobs/:id/pages','GET /recon/jobs/:id/secrets','DELETE /recon/jobs/:id'] },
  webapp: { title:'Web Application Assessment', eyebrow:'MODULE · WEBAPP', description:'Target-scoped web application scanning and finding generation.', capabilities:['Web application scans','Finding generation','Target-scoped execution','Scan cancellation'], routes:['POST /webapp/scans','GET /webapp/scans/:id/findings','DELETE /webapp/scans/:id'] },
  c2: { title:'C2', eyebrow:'MODULE · C2', description:'Implant registration, authenticated beacon handling, task queueing, and result collection.', capabilities:['Implant registration','Task queueing','Beacon handling','Task results'], routes:['POST /c2/implants','POST /c2/implants/:id/tasks','GET /c2/implants/:id/results','POST /c2/beacon'] },
  delivery: { title:'Delivery', eyebrow:'MODULE · DELIVERY', description:'Campaign orchestration, target ingestion, state control, and delivery tracking.', capabilities:['Campaign management','Target import','Campaign state control','Open/click tracking'], routes:['POST /delivery/campaigns','POST /delivery/campaigns/:id/targets','POST /delivery/campaigns/:id/state','GET /delivery/track/*'] },
  'evil-proxy': { title:'Evil Proxy', eyebrow:'MODULE · EVIL-PROXY', description:'Adversary-in-the-middle proxy workflows with lure and session management.', capabilities:['Phishing lures','Victim session tracking','Session export','Phishlet-backed proxying'], routes:['POST /evil-proxy/lures','GET /evil-proxy/sessions','GET /evil-proxy/sessions/:l/:v/export'] },
  mitm: { title:'MITM', eyebrow:'MODULE · MITM', description:'Network interception controls, DNS rule management, and captured traffic records.', capabilities:['DNS rules','DNS service control','Intercepted traffic','Credential capture records'], routes:['POST /mitm/dns/rules','POST /mitm/dns/start','GET /mitm/exchanges','GET /mitm/credentials'] },
  'post-exploit': { title:'Post-Exploit', eyebrow:'MODULE · POST-EXPLOIT', description:'Credential analysis and lateral-movement planning workflows tied to authorized engagements.', capabilities:['Hash ingestion','Kerberoast task queueing','AD attack-path planning','Secrets-dump task queueing'], routes:['POST /post-exploit/hashes','POST /post-exploit/kerberoast/queue','POST /post-exploit/pivot/paths','POST /post-exploit/dump'] },
};

export function Workspace({view,data,onNewEngagement}) {
  if (view.startsWith('module:')) {
    return <ModuleWorkspace module={view.slice('module:'.length)} data={data} />;
  }

  const cfg=configs[view]||{title:view.replace(/-/g,' '),eyebrow:'MODULE',fields:[['id','ID'],['status','Status'],['module','Module']]};
  const source=view==='engagements'?data.engagements:view==='targets'?data.targets:view==='findings'?data.findings:view==='evidence'?data.evidence:view==='sessions'?data.sessions:view==='audit'?data.audit:[];
  return <div className="page"><div className="page-intro"><div><span className="eyebrow">{cfg.eyebrow}</span><h1>{cfg.title}</h1><p>{data.engagement?.name ? `Current engagement: ${data.engagement.name}` : 'Select an engagement to scope operator data.'}</p></div>{view==='engagements'&&<button className="button button--silver" onClick={onNewEngagement}>＋ New engagement</button>}</div>
    <section className="panel workspace-panel"><div className="table-wrap"><table><thead><tr>{cfg.fields.map(([,label])=><th key={label}>{label}</th>)}</tr></thead><tbody>{source.map((row,i)=><tr key={row.id||i}>{cfg.fields.map(([key])=><td key={key}>{String(row[key] ?? row[key.replace('_','')] ?? '—')}</td>)}</tr>)}{!source.length&&<tr><td colSpan={cfg.fields.length}><div className="empty">No records for this view.</div></td></tr>}</tbody></table></div></section>
  </div>;
}

function ModuleWorkspace({ module, data }) {
  const info = moduleInfo[module] || { title: module, eyebrow: 'MODULE', description: 'Registered module.', capabilities:['Registered API capability'], routes:[] };
  const targets = data.targets ?? [];
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [targetValue, setTargetValue] = useState(targets[0]?.value ?? '');
  const [allowPrivateTargets, setAllowPrivateTargets] = useState(isPrivateTarget(targets[0]?.value ?? ''));
  const [running, setRunning] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const target = targets.find(item => item.id === targetId) ?? targets[0];
    if (!target) return;
    setTargetId(target.id);
    setTargetValue(target.value ?? '');
    setAllowPrivateTargets(isPrivateTarget(target.value ?? ''));
  }, [targetId, targets]);

  const selectedTarget = useMemo(() => targets.find(item => item.id === targetId) ?? null, [targets, targetId]);

  const selectTarget = event => {
    const next = targets.find(item => item.id === event.target.value);
    setTargetId(next?.id ?? '');
    setTargetValue(next?.value ?? '');
    setAllowPrivateTargets(isPrivateTarget(next?.value ?? ''));
    setError('');
    setMessage('');
  };

  const run = async event => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!data.engagement?.id) { setError('An active engagement is required.'); return; }
    if (!targetValue) { setError('Select a target first.'); return; }

    try {
      if (module === 'recon') {
        const result = await api.startRecon({
          engagementId: data.engagement.id,
          targetId: targetId || undefined,
          seedUrls: [targetValue],
          config: { allowPrivateTargets },
        });
        setRunning({ kind:'Recon job', id:result.jobId, status:result.status });
        setMessage(`Recon job ${result.jobId} started.`);
      } else if (module === 'webapp') {
        const result = await api.startWebappScan({
          engagementId: data.engagement.id,
          targetId: targetId || undefined,
          targetUrl: targetValue,
          config: { allowPrivateTargets },
        });
        setRunning({ kind:'Webapp scan', id:result.scanId, status:result.status });
        setMessage(`Web application scan ${result.scanId} started.`);
      } else {
        setError(`${info.title} is registered, but this console does not expose an active launcher for it yet.`);
      }
    } catch (err) {
      setError(err.message ?? 'Unable to start module process.');
    }
  };

  const cancel = async () => {
    if (!running) return;
    try {
      if (module === 'recon') await api.cancelRecon(running.id);
      if (module === 'webapp') await api.cancelWebappScan(running.id);
      setRunning(current => current ? { ...current, status:'cancelled' } : null);
      setMessage(`${running.kind} ${running.id} cancelled.`);
    } catch (err) {
      setError(err.message ?? 'Unable to cancel process.');
    }
  };

  return <div className="page">
    <div className="page-intro"><div><span className="eyebrow">{info.eyebrow}</span><h1>{info.title}</h1><p>{info.description}</p></div><span className="module-ready-badge">READY</span></div>
    <section className="panel capability-panel">
      <div className="panel-head"><div><span className="eyebrow">CAPABILITY SURFACE</span><h2>What this module can do</h2></div><span className="module-console-state">{info.capabilities.length} CAPABILITIES</span></div>
      <div className="capability-detail-grid">{info.capabilities.map(item=><div className="capability-detail" key={item}><span className="capability-icon">◇</span><div><strong>{item}</strong><small>Available in the module API</small></div></div>)}</div>
      <details className="route-details"><summary>API surface</summary><div className="route-list">{info.routes.map(route=><code key={route}>{route}</code>)}</div></details>
    </section>
    <section className="panel module-console">
      <div className="panel-head"><div><span className="eyebrow">OPERATOR CONTROL</span><h2>Run process</h2></div><span className="module-console-state">{running?.status?.toUpperCase() ?? 'IDLE'}</span></div>
      {module === 'recon' || module === 'webapp'
        ? <form onSubmit={run}>
            <label className="module-field"><span>Target</span><select value={targetId} onChange={selectTarget} disabled={!targets.length}>{targets.map(target=><option key={target.id} value={target.id}>{target.label || target.value}</option>)}</select></label>
            <label className="module-field"><span>Target value</span><input value={targetValue} onChange={event=>setTargetValue(event.target.value)} placeholder="http://127.0.0.1:3000" /></label>
            <label className="module-check"><input type="checkbox" checked={allowPrivateTargets} onChange={event=>setAllowPrivateTargets(event.target.checked)} /><span>Allow private/local target</span></label>
            <div className="module-actions"><button className="button button--silver" type="submit" disabled={!data.engagement?.id || !targetValue || running?.status==='running'}>{running?.status==='running' ? 'RUNNING…' : module==='recon' ? '▶ Start recon' : '▶ Start web scan'}</button>{running?.status==='running'&&<button className="button button--ghost" type="button" onClick={cancel}>Stop</button>}</div>
          </form>
        : <div className="module-placeholder"><strong>{info.title} is surfaced without inventing UI controls.</strong><span>The capability inventory above shows the real module surface and API routes, making previously hidden functionality discoverable while preserving the existing execution boundary.</span></div>}
      {error&&<div className="form-error">{error}</div>}
      {message&&<div className="module-success" role="status">{message}</div>}
    </section>
    {selectedTarget&&<section className="panel module-target"><span className="eyebrow">SELECTED TARGET</span><strong>{selectedTarget.label || selectedTarget.value}</strong><small>{selectedTarget.type || 'target'} · {selectedTarget.value}</small></section>}
  </div>;
}

function isPrivateTarget(value) {
  try {
    const url = new URL(value);
    return ['127.0.0.1','localhost','::1'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}
