// Primitives used everywhere.

import { Fragment } from 'react';
import { ChevronRight, Lock, Circle, Clock3, AlertCircle, CheckCircle2 } from 'lucide-react';
import { KIND, STATUS, ROLE_COLOR, ROLE_LABEL, initials, signed, maskSsn } from '../format.js';
import { actorById } from '../state/base.js';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { href } from '../state/router.js';

export function Kind({ kind }) {
  const k = KIND[kind] ?? KIND.adjustment;
  return <span className="kind"><span className="dot" style={{ background: k.color }} />{k.label}</span>;
}

const STATUS_ICON = { open: Circle, awaiting_signoff: Clock3, reopened: AlertCircle, closed: CheckCircle2 };

export function Status({ status }) {
  const s = STATUS[status] ?? STATUS.open;
  const Icon = STATUS_ICON[status] ?? Circle;
  return <span className={`pill ${s.tone}`}><Icon size={12} strokeWidth={2.4} />{s.label}</span>;
}

/** A summary figure: caption, big number, one line of context. */
export function Stat({ label, value, sub, icon: Icon, tone = '', onClick }) {
  return (
    <div className={`stat ${tone}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="top"><span className="cap">{label}</span>{Icon && <Icon size={18} />}</div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

/** The two taxpayers as overlapping initials. */
export function Household({ size = 28 }) {
  return (
    <span className="avatars">
      <span className="avatar" style={{ background: '#4449e0', width: size, height: size, fontSize: Math.round(size * 0.36) }}>NO</span>
      <span className="avatar" style={{ background: '#0e7090', width: size, height: size, fontSize: Math.round(size * 0.36) }}>EL</span>
    </span>
  );
}

export function Avatar({ id, size = 28 }) {
  const a = actorById.get(id);
  return (
    <span className="avatar" title={a ? `${a.name} · ${ROLE_LABEL[a.role]}` : id}
      style={{ background: ROLE_COLOR[a?.role] ?? '#a1a1aa', width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {initials(a?.name ?? id)}
    </span>
  );
}

export function Person({ id, role = false, size = 20 }) {
  const a = actorById.get(id);
  return (
    <span className="row" style={{ gap: 8, display: 'inline-flex' }}>
      <Avatar id={id} size={size} />
      <span className="ellipsis">{a?.name ?? id}{role && a && <span className="c3"> · {ROLE_LABEL[a.role]}</span>}</span>
    </span>
  );
}

/** Tax effect from the client's side: more tax is red, less is green. Fewer payments credited is red. */
export function Signed({ value, payments = false }) {
  if (!value) return <span className="c4">—</span>;
  const bad = payments ? value < 0 : value > 0;
  return <span className={`num ${bad ? 'red' : 'green'}`}>{signed(value)}</span>;
}

export const fedOf = (e) => (e?.federal ?? 0);
export const caOf = (e) => (e?.california ?? 0);
export const payOf = (e) => (e?.federal_payments ?? 0) + (e?.california_payments ?? 0);

export function Ref({ value, children }) {
  const { openTrace } = useWorkpaper();
  return <button type="button" className="ref" onClick={(e) => { e.stopPropagation(); openTrace({ ref: value }); }}>{children ?? value}</button>;
}

export function Crumbs({ items }) {
  return (
    <nav className="crumbs">
      {items.map(([label, to], i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight size={14} className="c4" />}
          {to ? <a href={href(...to)}>{label}</a> : <span className={i === items.length - 1 ? 'cur ellipsis' : ''}>{label}</span>}
        </Fragment>
      ))}
    </nav>
  );
}

/** Masked unless the viewer has clearance; every reveal is logged as an event. */
export function Sensitive({ value, field }) {
  const { canSeeSensitive, dispatch, state, actorId } = useWorkpaper();
  const revealed = state.viewLog?.some((v) => v.actor === actorId && v.payload.field === field);
  if (!canSeeSensitive) return <span className="num row" style={{ gap: 4, display: 'inline-flex' }}>{maskSsn(value)}<Lock size={11} className="c4" /></span>;
  if (revealed) return <span className="num">{value}</span>;
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <span className="num">{maskSsn(value)}</span>
      <button className="link t12" type="button" onClick={(e) => { e.stopPropagation(); dispatch({ kind: 'view_sensitive', target: field, payload: { field } }, { label: 'Unmasked view logged', undoable: false }); }}>Reveal</button>
    </span>
  );
}

export function Empty({ title, children }) {
  return <div className="empty"><div className="h3" style={{ color: 'var(--text)' }}>{title}</div>{children && <div className="mt8">{children}</div>}</div>;
}

export function KV({ items, cols = 4 }) {
  return (
    <div className="kv" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {items.filter(Boolean).map(([k, v], i) => <div key={i} style={{ minWidth: 0 }}><div className="k">{k}</div><div className="v">{v}</div></div>)}
    </div>
  );
}
