import { useEffect, useState } from 'react';
import { api } from '../api';

const configs = {
  engagements:{title:'Engagements',eyebrow:'SCOPE',fields:[['name','Name'],['status','Status'],['scope','Scope'],['description','Description']]},
  targets:{title:'Targets',eyebrow:'SCOPE',fields:[['type','Type'],['value','Value'],['label','Label']]},
  findings:{title:'Findings',eyebrow:'RISK',fields:[['severity','Severity'],['title','Title'],['module','Module'],['status','Status']]},
  evidence:{title:'Evidence',eyebrow:'COLLECTION',fields:[['type','Type'],['module','Module'],['label','Label']]},
  sessions:{title:'Sessions',eyebrow:'OPERATIONS',fields:[['module','Module'],['status','Status'],['transport','Transport']]},
  audit:{title:'Audit Log',eyebrow:'INTEGRITY',fields:[['action','Action'],['module','Module'],['created_at','Timestamp']]},
};

const moduleInfo = {
  recon:{title:'Reconnaissance',description:'Scoped discovery and collection against an authorized target.',capabilities:['Crawl targets','Inspect pages and assets','Collect evidence and discovered secrets','Cancel jobs'],routes:['POST /recon/jobs','GET /recon/jobs/:id','DELETE /recon/jobs/:id']},
  webapp:{title:'Web Application Assessment',description:'Target-scoped scanning, fuzzing, checks, and finding generation.',capabilities:['Create scans','Inspect scan state','Review findings','Cancel scans'],routes:['POST /webapp/scans','GET /webapp/scans/:id','DELETE /webapp/scans/:id']},
  c2:{title:'Command & Control',description:'Operator control of registered implants, task queues, beacons, and results.',capabilities:['Register implants','Queue supported tasks','Inspect queued tasks and results','Kill an implant'],routes:['POST /c2/implants','POST /c2/implants/:id/tasks','GET /c2/implants/:id/results','DELETE /c2/implants/:id']},
  delivery:{title:'Delivery',description:'Campaign preparation, target ingestion, SMTP profiles, state control, and tracking.',capabilities:['Create campaigns','Import targets','Configure SMTP','Control campaign state'],routes:['POST /delivery/campaigns','POST /delivery/campaigns/:id/targets','POST /delivery/smtp','POST /delivery/campaigns/:id/state']},
  'evil-proxy':{title:'Evil Proxy',description:'Lure, phishlet, victim-session, and privileged-session export controls.',capabilities:['Create and disable lures','Inspect phishlets','Monitor victim sessions','Export harvested session data'],routes:['POST /evil-proxy/lures','GET /evil-proxy/sessions','GET /evil-proxy/sessions/:lureId/:victimSid/export']},
  mitm:{title:'MITM',description:'Interception session, DNS, traffic, credential-record, and configuration controls.',capabilities:['Create/stop sessions','Manage DNS rules','Start/stop DNS service','Inspect traffic and credentials'],routes:['POST /mitm/sessions','POST /mitm/dns/rules','POST /mitm/dns/start','GET /mitm/exchanges']},
  'post-exploit':{title:'Post-Exploit',description:'Credential analysis, AD path analysis, and task orchestration through authorized implants.',capabilities:['Ingest hashes','Analyze attack paths','Queue Kerberoast tasks','Queue and parse dump results'],routes:['POST /post-exploit/hashes','POST /post-exploit/pivot/paths','POST /post-exploit/kerberoast/queue','POST /post-exploit/dump']},
};

export function Workspace({view,data,onNewEngagement}) {
  if (view.startsWith('module:')) return <ModuleWorkspace module={view.slice(7)} data={data} />;
  const cfg=configs[view]||{title:view.replace(/-/g,' '),eyebrow:'MODULE',fields:[['id','ID'],['status','Status'],['module','Module']]};
  const source=view==='engagements'?data.engagements:view==='targets'?data.targets:view==='findings'?data.findings:view==='evidence'?data.evidence:view==='sessions'?data.sessions:view==='audit'?data.audit:[];
  return <div className="page"><div className="page-intro"><div><span className="eyebrow">{cfg.eyebrow}</span><h1>{cfg.title}</h1><p>{data.engagement?.name?'Current engagement: '+data.engagement.name:'Select an engagement to scope operator data.'}</p></div>{view==='engagements'&&<button className="button button--silver" onClick={onNewEngagement}>＋ New engagement</button>}</div><section className="panel workspace-panel"><div className="table-wrap"><table><thead><tr>{cfg.fields.map(([,label])=><th key={label}>{label}</th>)}</tr></thead><tbody>{source.map((row,i)=><tr key={row.id||i}>{cfg.fields.map(([key])=><td key={key}>{String(row[key]??row[key.replace('_','')]??'—')}</td>)}</tr>)}{!source.length&&<tr><td colSpan={cfg.fields.length}><div className="empty">No records for this view.</div></td></tr>}</tbody></table></div></section></div>;
}

function ModuleWorkspace({module,data}) {
  const info=moduleInfo[module]||{title:module,description:'Registered module.',capabilities:['Registered API capability'],routes:[]};
  const eid=data.engagement?.id;
  const [state,setState]=useState({loading:true,error:'',message:'',data:null});
  const [selected,setSelected]=useState(null);
  const load=async()=>{
    if(!eid){setState({loading:false,error:'An active engagement is required.',message:'',data:null});return;}
    setState(s=>({...s,loading:true,error:''}));
    try{
      let result;
      if(module==='c2') result=await Promise.all([api.c2Implants(eid),api.c2Profiles(eid)]);
      else if(module==='delivery') result=await Promise.all([api.deliveryCampaigns(eid),api.deliverySmtp(eid)]);
      else if(module==='evil-proxy') result=await Promise.all([api.evilLures(eid),api.evilSessions(eid),api.evilPhishlets()]);
      else if(module==='mitm') result=await Promise.all([api.mitmSessions(eid),api.mitmStats(eid),api.mitmDnsRules(eid)]);
      else if(module==='post-exploit') result=await Promise.all([api.postHashes(eid),api.postStats(eid),api.pivotSurface(eid)]);
      else result=null;
      setState({loading:false,error:'',message:'',data:result});
    }catch(error){setState({loading:false,error:error.message,message:'',data:null});}
  };
  useEffect(()=>{load();},[eid,module]);
  return <div className="page">
    <div className="page-intro"><div><span className="eyebrow">MODULE CONTROL</span><h1>{info.title}</h1><p>{info.description}</p></div><span className="module-ready-badge">{eid?'LIVE':'NO SCOPE'}</span></div>
    <section className="panel capability-panel"><div className="panel-head"><div><span className="eyebrow">CONTROL SURFACE</span><h2>Operator controls</h2></div><button className="button button--ghost" onClick={load}>↻ Refresh</button></div><div className="capability-detail-grid">{info.capabilities.map(x=><div className="capability-detail" key={x}><span className="capability-icon">◇</span><div><strong>{x}</strong><small>Implemented against the existing module API</small></div></div>)}</div><details className="route-details"><summary>API surface</summary><div className="route-list">{info.routes.map(x=><code key={x}>{x}</code>)}</div></details></section>
    {state.error&&<div className="form-error">{state.error}</div>}
    {state.loading?<section className="panel"><div className="empty">Loading module state…</div></section>:<ModuleControls module={module} eid={eid} data={state.data} selected={selected} setSelected={setSelected} onRefresh={load} onMessage={m=>setState(s=>({...s,message:m,error:''}))}/>}
    {state.message&&<div className="module-success" role="status">{state.message}</div>}
  </div>;
}

function ModuleControls({module,eid,data,selected,setSelected,onRefresh,onMessage}) {
  if(module==='c2') return <C2Controls eid={eid} data={data} selected={selected} setSelected={setSelected} onRefresh={onRefresh} onMessage={onMessage}/>;
  if(module==='delivery') return <DeliveryControls eid={eid} data={data} onRefresh={onRefresh} onMessage={onMessage}/>;
  if(module==='evil-proxy') return <EvilControls eid={eid} data={data} onRefresh={onRefresh} onMessage={onMessage}/>;
  if(module==='mitm') return <MitmControls eid={eid} data={data} selected={selected} setSelected={setSelected} onRefresh={onRefresh} onMessage={onMessage}/>;
  if(module==='post-exploit') return <PostControls eid={eid} data={data} selected={selected} setSelected={setSelected} onRefresh={onRefresh} onMessage={onMessage}/>;
  return <LegacyExecution module={module}/>;
}

function Panel({title,children}){return <section className="panel module-console module-console--wide"><div className="panel-head"><div><span className="eyebrow">OPERATOR CONTROL</span><h2>{title}</h2></div></div>{children}</section>;}
function Field({label,value,onChange,type='text',placeholder}){return <label className="module-field"><span>{label}</span><input type={type} value={value??''} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/></label>;}
function JsonView({value}){return <pre className="module-json">{JSON.stringify(value??{},null,2)}</pre>;}
function Select({label,value,onChange,options}){return <label className="module-field"><span>{label}</span><select value={value??''} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;}

function C2Controls({eid,data,selected,setSelected,onRefresh,onMessage}) {
  const implants=data?.[0]?.implants??[], profiles=data?.[1]?.profiles??[];
  const [profileId,setProfileId]=useState(''),[sleepSec,setSleepSec]=useState('30'),[jitterPct,setJitterPct]=useState('20'),[task,setTask]=useState('sysinfo'),[cmd,setCmd]=useState(''),[result,setResult]=useState(null);
  const run=async fn=>{try{const r=await fn();setResult(r);onMessage('C2 operation completed.');await onRefresh();}catch(e){onMessage(e.message);}};
  return <div className="module-control-grid">
    <Panel title="Implant provisioning"><form onSubmit={e=>{e.preventDefault();run(()=>api.registerC2Implant({engagementId:eid,profileId:profileId||undefined,sleepSec:Number(sleepSec),jitterPct:Number(jitterPct)}));}}><Select label="Profile" value={profileId} onChange={setProfileId} options={[{value:'',label:'Default profile'},...profiles.map(p=>({value:p.id,label:p.name||p.id}))]}/><Field label="Sleep seconds" value={sleepSec} onChange={setSleepSec} type="number"/><Field label="Jitter %" value={jitterPct} onChange={setJitterPct} type="number"/><button className="button button--silver">Register implant</button></form></Panel>
    <Panel title="Implants"><div className="record-list">{implants.map(i=><button className={'record-row '+(selected?.id===i.id?'record-row--selected':'')} key={i.id} onClick={()=>setSelected(i)}><span><strong>{i.hostname||i.id}</strong><small>{i.os||'unknown OS'} · {i.state||'unknown'} · queued {i.queued??0}</small></span><code>{i.id.slice(0,8)}</code></button>)}{!implants.length&&<div className="empty">No implants in this engagement.</div>}</div>{selected&&<div className="module-actions"><button className="button button--ghost" onClick={()=>run(()=>api.c2Results(selected.id))}>Load results</button><button className="button button--ghost" onClick={()=>run(()=>api.killC2Implant(selected.id))}>Kill implant</button></div>}</Panel>
    <Panel title="Task queue"><form onSubmit={e=>{e.preventDefault();if(!selected)return onMessage('Select an implant first.');run(()=>api.queueC2Task(selected.id,{type:task,...(task==='shell'?{cmd}: {})}));}}><Select label="Task type" value={task} onChange={setTask} options={['sysinfo','screenshot','shell','upload','download','sleep','die'].map(x=>({value:x,label:x}))}/>{task==='shell'&&<Field label="Command" value={cmd} onChange={setCmd} placeholder="Authorized assessment command"/>}<button className="button button--silver" disabled={!selected}>Queue task</button></form></Panel>
    {result&&<Panel title="Last operation"><JsonView value={result}/></Panel>}
  </div>;
}

function DeliveryControls({eid,data,onRefresh,onMessage}) {
  const campaigns=data?.[0]?.campaigns??[], smtp=data?.[1]?.profiles??[];
  const [name,setName]=useState(''),[trackingBase,setTrackingBase]=useState(''),[fromName,setFromName]=useState(''),[fromEmail,setFromEmail]=useState(''),[template,setTemplate]=useState(JSON.stringify({subject:'',htmlBody:'',textBody:''},null,2)),[campaign,setCampaign]=useState(null),[targets,setTargets]=useState(''),[state,setState]=useState('ready'),[result,setResult]=useState(null);
  const run=async fn=>{try{const r=await fn();setResult(r);onMessage('Delivery operation completed.');await onRefresh();}catch(e){onMessage(e.message);}};
  return <div className="module-control-grid">
    <Panel title="Campaign"><form onSubmit={e=>{e.preventDefault();let tpl;try{tpl=JSON.parse(template);}catch{return onMessage('Template must be valid JSON.');}run(()=>api.createDeliveryCampaign({engagementId:eid,name,trackingBase,fromName,fromEmail,template:tpl,sendsPerHour:60}));}}><Field label="Name" value={name} onChange={setName} placeholder="Assessment campaign"/><Field label="Tracking base" value={trackingBase} onChange={setTrackingBase} placeholder="https://authorized.example/track"/><Field label="From name" value={fromName} onChange={setFromName}/><Field label="From email" value={fromEmail} onChange={setFromEmail}/><label className="module-field"><span>Template JSON</span><textarea value={template} onChange={e=>setTemplate(e.target.value)} rows="8"/></label><button className="button button--silver">Create campaign</button></form></Panel>
    <Panel title="Campaign control"><Select label="Campaign" value={campaign?.id??''} onChange={id=>setCampaign(campaigns.find(c=>c.id===id)??null)} options={[{value:'',label:'Select campaign'},...campaigns.map(c=>({value:c.id,label:c.name+' · '+c.state}))]}/><Select label="Transition" value={state} onChange={setState} options={['ready','running','paused','complete'].map(x=>({value:x,label:x}))}/><div className="module-actions"><button className="button button--silver" disabled={!campaign} onClick={()=>run(()=>api.transitionDelivery(campaign.id,state))}>Apply state</button><button className="button button--ghost" disabled={!campaign} onClick={()=>run(()=>api.deliveryStats(campaign.id))}>Stats</button></div>{campaign&&<small className="module-note">Current state: {campaign.state}</small>}</Panel>
    <Panel title="Campaign targets"><Select label="Campaign" value={campaign?.id??''} onChange={id=>setCampaign(campaigns.find(c=>c.id===id)??null)} options={[{value:'',label:'Select campaign'},...campaigns.map(c=>({value:c.id,label:c.name}))]}/><label className="module-field"><span>Targets, one per line or CSV</span><textarea value={targets} onChange={e=>setTargets(e.target.value)} rows="7"/></label><button className="button button--silver" disabled={!campaign} onClick={()=>run(()=>api.addDeliveryTargets(campaign.id,{csv:targets}))}>Import targets</button></Panel>
    <Panel title="SMTP profiles"><div className="record-list">{smtp.map(p=><div className="record-row" key={p.id}><span><strong>{p.id}</strong><small>{p.host}:{p.port}</small></span><button className="button button--ghost" onClick={()=>run(()=>api.deleteDeliverySmtp(p.id,eid))}>Remove</button></div>)}{!smtp.length&&<div className="empty">No SMTP profiles configured.</div>}</div></Panel>
    {result&&<Panel title="Last operation"><JsonView value={result}/></Panel>}
  </div>;
}

function EvilControls({eid,data,onRefresh,onMessage}) {
  const lures=data?.[0]?.lures??[],sessions=data?.[1]?.sessions??[],phishlets=data?.[2]?.phishlets??[];
  const [phishletName,setPhishletName]=useState(''),[phishDomain,setPhishDomain]=useState(''),[session,setSession]=useState(null),[result,setResult]=useState(null);
  const run=async fn=>{try{const r=await fn();setResult(r);onMessage('Evil Proxy operation completed.');await onRefresh();}catch(e){onMessage(e.message);}};
  return <div className="module-control-grid">
    <Panel title="Lure control"><form onSubmit={e=>{e.preventDefault();run(()=>api.createEvilLure({engagementId:eid,phishletName,phishDomain}));}}><Select label="Phishlet" value={phishletName} onChange={setPhishletName} options={[{value:'',label:'Select phishlet'},...phishlets.map(x=>({value:typeof x==='string'?x:x.name,label:typeof x==='string'?x:x.name}))]}/><Field label="Phish domain" value={phishDomain} onChange={setPhishDomain} placeholder="authorized.example"/><button className="button button--silver">Create lure</button></form><div className="record-list">{lures.map(l=><div className="record-row" key={l.id}><span><strong>{l.phishDomain}</strong><small>{l.phishletName||'override'} · {l.active?'active':'disabled'}</small></span><button className="button button--ghost" onClick={()=>run(()=>api.disableEvilLure(l.id))}>Disable</button></div>)}</div></Panel>
    <Panel title="Victim sessions"><div className="record-list">{sessions.map(s=><button className="record-row" key={s.lureId+'-'+s.victimSid} onClick={()=>setSession(s)}><span><strong>{s.victimSid}</strong><small>{s.phishletName} · {s.state}</small></span><code>{s.lureId?.slice(0,8)}</code></button>)}{!sessions.length&&<div className="empty">No sessions recorded.</div>}</div>{session&&<div className="module-actions"><button className="button button--ghost" onClick={()=>run(()=>api.evilSession(session.lureId,session.victimSid))}>Inspect</button><button className="button button--ghost" onClick={()=>run(()=>api.exportEvilSession(session.lureId,session.victimSid))}>Export harvested data</button></div>}</Panel>
    {result&&<Panel title="Last operation"><JsonView value={result}/></Panel>}
  </div>;
}

function MitmControls({eid,data,selected,setSelected,onRefresh,onMessage}) {
  const sessions=data?.[0]?.sessions??[],stats=data?.[1]??{},rules=data?.[2]?.rules??[];
  const [type,setType]=useState('transparent'),[hostname,setHostname]=useState(''),[spoofIp,setSpoofIp]=useState(''),[result,setResult]=useState(null);
  const run=async fn=>{try{const r=await fn();setResult(r);onMessage('MITM operation completed.');await onRefresh();}catch(e){onMessage(e.message);}};
  return <div className="module-control-grid">
    <Panel title="Interception session"><Select label="Session type" value={type} onChange={setType} options={['transparent','explicit','socks5'].map(x=>({value:x,label:x}))}/><button className="button button--silver" onClick={()=>run(()=>api.createMitmSession({engagementId:eid,type,config:{}}))}>Create session</button><div className="record-list">{sessions.map(s=><button className={'record-row '+(selected?.id===s.id?'record-row--selected':'')} key={s.id} onClick={()=>setSelected(s)}><span><strong>{s.id.slice(0,8)}</strong><small>{s.type} · {s.status}</small></span><code>{s.id}</code></button>)}</div>{selected&&<button className="button button--ghost" onClick={()=>run(()=>api.stopMitmSession(selected.id))}>Stop selected session</button>}</Panel>
    <Panel title="DNS control"><div className="module-actions"><button className="button button--silver" onClick={()=>run(()=>api.startMitmDns({eid}))}>Start DNS</button><button className="button button--ghost" onClick={()=>run(()=>api.stopMitmDns({eid}))}>Stop DNS</button></div><form onSubmit={e=>{e.preventDefault();if(!selected)return onMessage('Select a MITM session first.');run(()=>api.addMitmDnsRule({sessionId:selected.id,hostname,spoofIp}));}}><Field label="Hostname" value={hostname} onChange={setHostname} placeholder="authorized.example"/><Field label="IPv4 address" value={spoofIp} onChange={setSpoofIp} placeholder="192.0.2.10"/><button className="button button--silver" disabled={!selected}>Add DNS rule</button></form><div className="record-list">{rules.map(r=><div className="record-row" key={r.session_id+'-'+r.hostname}><span><strong>{r.hostname}</strong><small>{r.spoof_ip}</small></span></div>)}</div></Panel>
    <Panel title="Captured traffic"><div className="module-actions"><button className="button button--ghost" onClick={()=>run(()=>api.mitmExchanges(eid))}>Load exchanges</button><button className="button button--ghost" onClick={()=>run(()=>api.mitmCredentials(eid))}>Load credentials</button></div><small className="module-note">Stats: {stats.totalExchanges??0} exchanges · {stats.totalCredentials??0} credentials</small></Panel>
    {result&&<Panel title="Last operation"><JsonView value={result}/></Panel>}
  </div>;
}

function PostControls({eid,data,selected,setSelected,onRefresh,onMessage}) {
  const hashes=data?.[0]?.hashes??[],stats=data?.[1]??{},surface=data?.[2]??{};
  const [output,setOutput]=useState(''),[implantId,setImplantId]=useState(''),[spns,setSpns]=useState(''),[dumpType,setDumpType]=useState('env_secrets'),[fromNodeIds,setFromNodeIds]=useState(''),[result,setResult]=useState(null);
  const run=async fn=>{try{const r=await fn();setResult(r);onMessage('Post-Exploit operation completed.');await onRefresh();}catch(e){onMessage(e.message);}};
  return <div className="module-control-grid">
    <Panel title="Hash ingestion"><label className="module-field"><span>Parsed output</span><textarea rows="7" value={output} onChange={e=>setOutput(e.target.value)} placeholder="Authorized assessment output"/></label><Field label="Implant ID (optional)" value={implantId} onChange={setImplantId}/><button className="button button--silver" onClick={()=>run(()=>api.ingestHashes({engagementId:eid,output,implantId:implantId||undefined,source:'operator-console'}))}>Ingest hashes</button><div className="record-list">{hashes.slice(0,8).map(h=><button className={'record-row '+(selected?.id===h.id?'record-row--selected':'')} key={h.id} onClick={()=>setSelected(h)}><span><strong>{h.user||h.id}</strong><small>{h.type} · {h.format} · {h.cracked?'cracked':'uncracked'}</small></span></button>)}</div></Panel>
    <Panel title="Kerberoast / dump tasks"><Field label="Implant ID" value={implantId} onChange={setImplantId}/><Field label="SPNs, one per line" value={spns} onChange={setSpns}/><button className="button button--silver" onClick={()=>run(()=>api.queueKerberoast({implantId,spns:spns?spns.split(/\r?\n/).filter(Boolean):undefined}))}>Queue Kerberoast</button><Select label="Dump type" value={dumpType} onChange={setDumpType} options={['env_secrets','sam','lsass','wifi','all'].map(x=>({value:x,label:x}))}/><button className="button button--ghost" onClick={()=>run(()=>api.queueDump({implantId,type:dumpType}))}>Queue dump</button></Panel>
    <Panel title="AD attack-path analysis"><Field label="Starting node IDs, one per line" value={fromNodeIds} onChange={setFromNodeIds}/><div className="module-actions"><button className="button button--silver" onClick={()=>run(()=>api.computePivotPaths({engagementId:eid,fromNodeIds:fromNodeIds.split(/\r?\n/).filter(Boolean)}))}>Compute paths</button><button className="button button--ghost" onClick={()=>run(()=>api.pivotPaths(eid))}>Load paths</button></div><small className="module-note">{surface.message||'AD graph surface is loaded for this engagement.'}</small></Panel>
    <Panel title="Module state"><div className="metrics metrics--compact"><div className="metric"><span>Hashes</span><strong>{stats.hashes??hashes.length}</strong></div><div className="metric"><span>Attack paths</span><strong>{stats.attackPaths??'—'}</strong></div><div className="metric"><span>Cracked</span><strong>{stats.cracked??'—'}</strong></div></div>{result&&<JsonView value={result}/>}</Panel>
  </div>;
}
function LegacyExecution({module}){return <Panel title="Execution"><div className="module-placeholder"><strong>{module==='recon'?'Recon':'Web Application Assessment'} retains its existing execution console.</strong><span>Use the existing controls exposed by the current application shell.</span></div></Panel>;}
