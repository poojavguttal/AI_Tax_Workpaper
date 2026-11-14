import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, ListChecks, Table2, FileText, History, ChevronsUpDown, Check, RotateCcw, Lock } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { actorsList, packet } from '../state/base.js';
import { ROLE_LABEL } from '../format.js';
import { Avatar, Household } from './ui.jsx';
import { href } from '../state/router.js';

export function Sidebar({ path }) {
  const { state } = useWorkpaper();
  const findings = state.items.filter((i) => ['error', 'conflict', 'judgment', 'adjustment'].includes(i.kind) && i.status !== 'closed').length;
  const nav = [
    ['overview', 'Overview', LayoutGrid],
    ['queue', 'Review', ListChecks, findings],
    ['return', 'Return', Table2],
    ['documents', 'Documents', FileText, packet.documents.length],
    ['history', 'Activity', History],
  ];
  const active = { finding: 'queue', document: 'documents' }[path] ?? path;
  return (
    <aside className="sidebar">
      <div className="logo"><span className="wordmark">mira<b>flores.</b></span></div>
      <div className="ctx">
        <Household size={26} />
        <div className="grow">
          <div className="w6 ellipsis">Okafor-Lindqvist</div>
          <div className="t12 c3">2025 · Joint return</div>
        </div>
        <ChevronsUpDown size={14} className="c4" />
      </div>
      <div className="navlist">
        <div className="navgroup cap">Workpaper</div>
        {nav.map(([p, label, Icon, n]) => (
          <a key={p} href={href(p)} className={`nav ${active === p ? 'on' : ''}`}>
            <Icon size={18} strokeWidth={1.9} />{label}{n !== undefined && <span className="n">{n}</span>}
          </a>
        ))}
      </div>
      <Me />
    </aside>
  );
}

function Me() {
  const { actor, switchActor, resetDemo, store, canSeeSensitive } = useWorkpaper();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!actor) return null;
  return (
    <div className="me" ref={ref}>
      {actor.kind === 'staff' && !canSeeSensitive && (
        <div className="row t12 amber mb8" style={{ padding: '0 6px' }}><Lock size={12} /> Sensitive data masked</div>
      )}
      <button type="button" className="me-btn" onClick={() => setOpen(!open)}>
        <Avatar id={actor.id} size={36} />
        <div className="grow">
          <div className="w5 ellipsis">{actor.name}</div>
          <div className="t12 c3">{ROLE_LABEL[actor.role]}{actor.credential ? `, ${actor.credential}` : ''}</div>
        </div>
        <ChevronsUpDown size={14} className="c4" />
      </button>
      {open && (
        <div className="pop" style={{ bottom: 'calc(100% - 4px)', left: 12, width: 300 }}>
          <div className="label" style={{ padding: '8px 8px 4px' }}>Switch role</div>
          {actorsList.map((a) => (
            <div key={a.id} className="pop-item" onClick={() => { switchActor(a.id); setOpen(false); }}>
              <Avatar id={a.id} size={26} />
              <div className="grow">
                <div className="w5">{a.name}</div>
                <div className="t12 c3">{ROLE_LABEL[a.role]}{a.credential ? `, ${a.credential}` : ''}{a.kind === 'staff' && !a.sensitive_data_clearance ? ' · no clearance' : ''}{a.active_from > '2026-12-31' ? ` · from ${a.active_from.slice(0, 4)}` : ''}</div>
              </div>
              {a.id === actor.id && <Check size={15} className="c2" />}
            </div>
          ))}
          <div className="hr" style={{ margin: '4px 0' }} />
          <div className="pop-item t12 c3" style={{ cursor: 'default' }}>{store?.kind === 'supabase' ? 'Shared log · Supabase' : 'Saved in this browser'}</div>
          {store?.kind === 'local' && (
            <div className="pop-item t12" onClick={() => { if (window.confirm('Clear every recorded event and start again from the engine output?')) { resetDemo(); setOpen(false); } }}>
              <RotateCcw size={13} /> Reset workpaper
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Header({ children, right }) {
  return (
    <header className="header">
      <div className="grow">{children}</div>
      {right}
      <span className="pill outline" title={`Computed ${packet.index.versions.get('v3').computed_at}`}>Engine v3</span>
    </header>
  );
}

export function Toasts() {
  const { toasts } = useWorkpaper();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'warn' ? 'warn' : ''}`}>
          <span className="grow">{t.text}</span>
          {t.action && <button type="button" onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
