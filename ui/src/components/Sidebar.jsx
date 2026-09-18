const nav = [
  ['dashboard','Dashboard','⌂'], ['engagements','Engagements','◈'], ['targets','Targets','◎'],
  ['findings','Findings','△'], ['evidence','Evidence','▣'], ['sessions','Sessions','◉'], ['audit','Audit','≡'],
];
export function Sidebar({ activeView, onNavigate, mobileOpen, onClose }) {
  return <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
    <div className="brand"><div className="brand-mark">☾</div><div><strong>HECATE</strong><span>OPERATOR CONSOLE</span></div></div>
    <nav aria-label="Primary navigation">{nav.map(([id,label,icon]) =>
      <button key={id} className={activeView === id ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => { onNavigate(id); onClose?.(); }}>
        <span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>
      </button>)}</nav>
    <div className="sidebar-foot"><span className="pulse" />LOCAL NODE<div>Zero backend dependency</div></div>
  </aside>;
}
