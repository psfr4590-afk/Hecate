export function Topbar({ engagement, engagements, onEngagementChange, connected, onConnect, onMenu, onSearch }) {
  return <header className="topbar">
    <button className="icon-button menu-button" onClick={onMenu} aria-label="Open navigation">☰</button>
    <div className="engagement-control"><span>ENGAGEMENT</span>
      <select value={engagement?.id ?? ''} onChange={e => onEngagementChange(e.target.value)} disabled={!engagement}>
        {engagements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </div>
    <button className="search-trigger" onClick={onSearch}><span>Search operator data</span><kbd>Ctrl K</kbd></button>
    <div className={`connection ${connected ? 'connection--live' : ''}`}><span className="status-dot" />{connected ? 'LOCAL NODE CONNECTED' : 'PREVIEW'}</div>
    <button className="button button--silver" onClick={onConnect}>{connected ? 'NODE' : 'CONNECT'}</button>
  </header>;
}
