// People: questions that become evidence, assignments, notifications and presence.

import { useEffect, useRef, useState } from 'react';
import { Bell, MessageCircleQuestion, UserPlus, CalendarClock, BadgeCheck, AlertTriangle, CornerDownRight } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { actorsList, actorById, packet } from '../state/base.js';
import { fmtDate, fmtDateTime, ROLE_LABEL } from '../format.js';
import { Avatar, Person } from './ui.jsx';
import { navigate } from '../state/router.js';

const today = () => new Date().toISOString().slice(0, 10);
const PATH_NAMES = { overview: 'Overview', queue: 'Review', finding: 'a finding', return: 'Return', schedules: 'Schedules', documents: 'Documents', document: 'a document', history: 'Activity', inbox: 'Inbox', versions: 'Versions', filing: 'Filing', nextyear: 'Next year', firm: 'Firm', client: 'Client portal', examiner: 'Examiner view' };

/** Where a question or assignment points, as a link. */
export function targetLink(state, target) {
  if (!target || target === 'return') return { label: 'The return', go: () => navigate('overview') };
  if (state.itemsById.get(target)) return { label: state.itemsById.get(target).title, go: () => navigate('finding', { id: target }) };
  if (packet.index.lines.get(`v3|${target}`)) return { label: `Line ${target}`, go: () => navigate('return', { line: target }) };
  if (packet.raw.firm.budget_hours[target] !== undefined) return { label: target.replace(/_/g, ' '), go: () => navigate('firm') };
  return { label: target, go: null };
}

// ── Questions ───────────────────────────────────────────────────────────────

export function QuestionThread({ q, compact = false }) {
  const { state, dispatch, actor } = useWorkpaper();
  const [text, setText] = useState('');
  const to = actorById.get(q.payload.to);
  const canAnswer = !q.answer && (q.payload.to === actor?.id || (to?.kind === 'client' && actor?.kind === 'client'));
  const t = targetLink(state, q.target);
  return (
    <div className="qa">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Avatar id={q.actor} size={28} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row t12 c3" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="w6 c1">{actorById.get(q.actor)?.name}</span> asked <span className="w6 c1">{to?.kind === 'client' ? `${to.name} (client)` : to?.name}</span> · {fmtDateTime(q.at)}
            {q.payload.blocking && !q.answer && <span className="pill amber">Blocks filing</span>}
            {q.answer ? <span className="pill green">Answered · evidence</span> : <span className="pill outline">Waiting</span>}
          </div>
          <div className="mt8">{q.payload.text}</div>
          {!compact && q.target && q.target !== 'return' && t.go && <button type="button" className="linkish t12 mt8" onClick={t.go}>{t.label}</button>}
        </div>
      </div>
      {q.answer && (
        <div className="qa-answer">
          <CornerDownRight size={14} className="c4" />
          <div className="grow">
            <div className="t12 c3"><span className="w6 c1">{actorById.get(q.answer.actor)?.name}</span> · {fmtDateTime(q.answer.at)} · <span className="mono">{q.answer.id}</span></div>
            <div className="mt4">{q.answer.payload.text}</div>
          </div>
        </div>
      )}
      {canAnswer && (
        <div className="row mt12" style={{ gap: 8 }}>
          <input className="input grow" placeholder="Your answer" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="btn sm primary" disabled={!text} onClick={() => { dispatch({ kind: 'answer', target: q.id, payload: { text } }, { label: 'Answer recorded as evidence' }); setText(''); }}>Answer</button>
        </div>
      )}
    </div>
  );
}

export function AskForm({ target, defaultTo }) {
  const { dispatch, actor } = useWorkpaper();
  const people = actorsList.filter((a) => a.id !== actor?.id && (actor?.kind === 'staff' ? true : a.kind === 'staff') && !(a.active_from > today()));
  const [to, setTo] = useState(defaultTo ?? people.find((p) => p.kind === 'client')?.id ?? people[0]?.id);
  const [text, setText] = useState('');
  const [blocking, setBlocking] = useState(false);
  if (!actor) return null;
  return (
    <div className="col gap12">
      <div className="row" style={{ gap: 8 }}>
        <span className="t13 c2">Ask</span>
        <select className="select" style={{ maxWidth: 280 }} value={to} onChange={(e) => setTo(e.target.value)}>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.kind === 'client' ? 'client' : ROLE_LABEL[p.role]}</option>)}
        </select>
      </div>
      <textarea className="textarea" placeholder="The question. The answer is kept with this item as evidence." value={text} onChange={(e) => setText(e.target.value)} />
      <div className="between">
        {actor.kind === 'staff' ? <label className="row t12 c2"><input type="checkbox" className="check" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} /> Block filing until answered</label> : <span />}
        <button type="button" className="btn sm" disabled={!text} onClick={() => { dispatch({ kind: 'ask', target, payload: { to, text, blocking } }, { label: 'Question sent' }); setText(''); }}>Send question</button>
      </div>
    </div>
  );
}

export function Questions({ target }) {
  const { state } = useWorkpaper();
  const qs = state.questions.filter((q) => q.target === target);
  return (
    <div style={{ padding: '20px 24px' }}>
      {qs.length === 0 && <div className="c3 mb16">No questions yet. Ask the client or a colleague; the answer becomes evidence for this item.</div>}
      {qs.map((q) => <QuestionThread key={q.id} q={q} compact />)}
      <AskForm target={target} />
    </div>
  );
}

// ── Assignment ──────────────────────────────────────────────────────────────

export function AssignBox({ target, compact = false }) {
  const { state, dispatch, actor } = useWorkpaper();
  const a = state.assignments[target];
  const [open, setOpen] = useState(false);
  const staff = actorsList.filter((p) => p.kind === 'staff' && ['preparer', 'reviewer', 'partner'].includes(p.role) && !(p.active_from > today()));
  const [to, setTo] = useState(a?.payload.to ?? staff[0]?.id);
  const [due, setDue] = useState(a?.payload.due ?? '');
  const canAssign = ['reviewer', 'partner', 'firm_administrator'].includes(actor?.role);
  const overdue = a?.payload.due && a.payload.due < today();
  return (
    <div className={compact ? '' : 'assign'}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <UserPlus size={15} className="c3" />
        {a ? <><span className="t13">Assigned to</span><Person id={a.payload.to} size={20} />{a.payload.due && <span className={`pill ${overdue ? 'red' : 'outline'}`}><CalendarClock size={12} /> due {fmtDate(a.payload.due)}</span>}</> : <span className="t13 c3">Not assigned</span>}
        {canAssign && <button type="button" className="btn sm ghost" onClick={() => setOpen(!open)}>{a ? 'Reassign' : 'Assign'}</button>}
      </div>
      {open && (
        <div className="row mt12" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="select" style={{ width: 200 }} value={to} onChange={(e) => setTo(e.target.value)}>{staff.map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE_LABEL[p.role]}</option>)}</select>
          <input type="date" className="input" style={{ width: 160 }} value={due} onChange={(e) => setDue(e.target.value)} />
          <button type="button" className="btn sm primary" onClick={() => { dispatch({ kind: 'assign', target, payload: { to, due: due || null } }, { label: `Assigned to ${actorById.get(to)?.name}` }); setOpen(false); }}>Save</button>
        </div>
      )}
    </div>
  );
}

// ── Notifications ───────────────────────────────────────────────────────────

export function useNotifications() {
  const { state, actor } = useWorkpaper();
  if (!actor) return [];
  const out = [];
  const isClient = actor.kind === 'client';
  for (const q of state.questions) {
    const to = actorById.get(q.payload.to);
    if (!q.answer && (q.payload.to === actor.id || (isClient && to?.kind === 'client'))) out.push({ id: `q-${q.id}`, icon: MessageCircleQuestion, tone: q.payload.blocking ? 'amber' : '', text: `${actorById.get(q.actor)?.name} asked you a question`, sub: q.payload.text, at: q.at, go: () => navigate(isClient ? 'client' : 'inbox') });
    if (q.answer && q.actor === actor.id) out.push({ id: `a-${q.id}`, icon: CornerDownRight, tone: 'green', text: `${actorById.get(q.answer.actor)?.name} answered`, sub: q.answer.payload.text, at: q.answer.at, go: () => navigate('inbox') });
  }
  if (isClient) {
    const partnerSigned = state.returnSignoffs.some((s) => s.valid && s.payload.level === 'partner');
    if (partnerSigned && !state.approvals.some((a) => a.valid)) out.push({ id: 'approve', icon: BadgeCheck, tone: 'amber', text: 'Your return is ready to approve', sub: 'Review the summary and sign the e-file authorization', at: state.returnSignoffs.at(-1)?.at, go: () => navigate('client') });
    return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  }
  for (const i of state.items) {
    if (i.assignment?.payload.to === actor.id && i.status !== 'closed') out.push({ id: `as-${i.id}`, icon: UserPlus, tone: i.assignment.payload.due && i.assignment.payload.due < today() ? 'red' : '', text: `Assigned to you${i.assignment.payload.due ? `, due ${fmtDate(i.assignment.payload.due)}` : ''}`, sub: i.title, at: i.assignment.at, go: () => navigate('finding', { id: i.id }) });
    const level = actor.role === 'partner' ? 'partner' : actor.role === 'reviewer' ? 'reviewer' : null;
    const needsMe = level && i.closing && i.closing.actor !== actor.id && i.requiredSignoffs.includes(level) && !i.signoffs.some((s) => s.payload.level === level && !i.stale.includes(s.id));
    if (needsMe) out.push({ id: `so-${i.id}`, icon: BadgeCheck, tone: '', text: `Waiting for your ${level} sign-off`, sub: i.title, at: i.closing.at, go: () => navigate('finding', { id: i.id }) });
  }
  for (const n of state.notes) if (!n.resolved && n.payload.blocking && n.actor !== actor.id && actor.role === 'preparer') out.push({ id: `n-${n.id}`, icon: AlertTriangle, tone: 'amber', text: `${actorById.get(n.actor)?.name} left a blocking review note`, sub: n.payload.text, at: n.at, go: () => (state.itemsById.get(n.target) ? navigate('finding', { id: n.target }) : navigate('inbox')) });
  const rejected = state.filings.at(-1)?.rejected;
  if (rejected) out.push({ id: `rej-${rejected.id}`, icon: AlertTriangle, tone: 'red', text: `E-file rejected: ${rejected.payload.code}`, sub: rejected.payload.message, at: rejected.at, go: () => navigate('filing') });
  const next = packet.raw.firm.deadlines.filter((d) => d.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (next && !state.filed) out.push({ id: 'deadline', icon: CalendarClock, tone: '', text: `Next deadline ${fmtDate(next.date)}`, sub: next.what, at: '', go: () => navigate('filing') });
  return out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}

export function NotificationBell() {
  const list = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const urgent = list.filter((n) => n.id !== 'deadline').length;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn sm icon ghost bell" onClick={() => setOpen(!open)} aria-label="Notifications">
        <Bell size={17} />{urgent > 0 && <span className="bell-n">{urgent}</span>}
      </button>
      {open && (
        <div className="pop notif-pop">
          <div className="between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}><span className="w6">Notifications</span><span className="t12 c3">{urgent} for you</span></div>
          {list.length === 0 && <div className="t13 c3" style={{ padding: 16 }}>Nothing needs you right now.</div>}
          {list.slice(0, 8).map((n) => {
            const Icon = n.icon;
            return (
              <div key={n.id} className="notif" onClick={() => { n.go?.(); setOpen(false); }}>
                <span className={`icotile sm ${n.tone}`}><Icon size={15} /></span>
                <div className="grow" style={{ minWidth: 0 }}><div className="t13 w5">{n.text}</div><div className="t12 c3 ellipsis">{n.sub}</div></div>
              </div>
            );
          })}
          <div className="notif" style={{ justifyContent: 'center' }} onClick={() => { navigate('inbox'); setOpen(false); }}><span className="t13" style={{ color: 'var(--primary)' }}>Open inbox</span></div>
        </div>
      )}
    </div>
  );
}

// ── Presence ────────────────────────────────────────────────────────────────

export function PresenceDots() {
  const { presence } = useWorkpaper();
  const peers = presence;
  if (!peers.length) return null;
  const here = window.location.hash;
  return (
    <div className="presence" title="Open in other tabs or windows right now">
      {peers.slice(0, 4).map((p) => {
        const a = actorById.get(p.actorId);
        const same = here.includes(p.where.split(':')[1] ?? '§') || here.replace(/^#\/?/, '').split('?')[0] === p.path;
        return (
          <span key={p.tab} className={`pres ${same ? 'same' : ''}`} title={`${a?.name} · ${same ? 'viewing this screen' : `on ${PATH_NAMES[p.path] ?? p.path}`}`}>
            <Avatar id={p.actorId} size={26} />
          </span>
        );
      })}
      <span className="t12 c3">{peers.length === 1 ? `${actorById.get(peers[0].actorId)?.name.split(' ')[0]} is ${peers[0].path === (here.replace(/^#\/?/, '').split('?')[0] || 'overview') ? 'here too' : `on ${PATH_NAMES[peers[0].path] ?? peers[0].path}`}` : `${peers.length} others online`}</span>
    </div>
  );
}
