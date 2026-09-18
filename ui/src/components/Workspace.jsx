const configs={
  engagements:{title:'Engagements',eyebrow:'SCOPE',fields:[['name','Name'],['status','Status'],['scope','Scope'],['description','Description']]},
  targets:{title:'Targets',eyebrow:'SCOPE',fields:[['type','Type'],['value','Value'],['label','Label']]},
  findings:{title:'Findings',eyebrow:'RISK',fields:[['severity','Severity'],['title','Title'],['module','Module'],['status','Status']]},
  evidence:{title:'Evidence',eyebrow:'COLLECTION',fields:[['type','Type'],['module','Module'],['label','Label']]},
  sessions:{title:'Sessions',eyebrow:'OPERATIONS',fields:[['module','Module'],['status','Status'],['transport','Transport']]},
  audit:{title:'Audit Log',eyebrow:'INTEGRITY',fields:[['action','Action'],['module','Module'],['created_at','Timestamp']]},
};
export function Workspace({view,data,onNewEngagement}) {
  const cfg=configs[view]||{title:view.replace(/-/g,' '),eyebrow:'MODULE',fields:[['id','ID'],['status','Status'],['module','Module']]};
  const source=view==='engagements'?data.engagements:view==='targets'?data.targets:view==='findings'?data.findings:view==='evidence'?data.evidence:view==='sessions'?data.sessions:view==='audit'?data.audit:[];
  return <div className="page"><div className="page-intro"><div><span className="eyebrow">{cfg.eyebrow}</span><h1>{cfg.title}</h1><p>{data.engagement?.name ? `Current engagement: ${data.engagement.name}` : 'Select an engagement to scope operator data.'}</p></div>{view==='engagements'&&<button className="button button--silver" onClick={onNewEngagement}>＋ New engagement</button>}</div>
    <section className="panel workspace-panel"><div className="table-wrap"><table><thead><tr>{cfg.fields.map(([,label])=><th key={label}>{label}</th>)}</tr></thead><tbody>{source.map((row,i)=><tr key={row.id||i}>{cfg.fields.map(([key])=><td key={key}>{String(row[key] ?? row[key.replace('_','')] ?? '—')}</td>)}</tr>)}{!source.length&&<tr><td colSpan={cfg.fields.length}><div className="empty">No records for this view.</div></td></tr>}</tbody></table></div></section>
  </div>;
}
