import { useState } from 'react';
import { Undo2, Search, Wrench, Gavel, BadgeCheck, MessageSquare, Eye, Send, PenLine, CircleDot, Users, ShieldAlert, History as HistoryIcon } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { ACTION_WORDS, fmtDateTime } from '../format.js';
import { Person, Crumbs, Empty, Stat } from '../components/ui.jsx';
import { actorById } from '../state/base.js';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';

export function History() {
  const { state, actor, dispatch } = useWorkpaper();
  const [show, setShow] = useState('all');
  const rows = [...state.log].reverse().filter((l) => show === 'all' || l.status === show);
  const canUndo = (e) => !['revert', 'file', 'view_sensitive'].includes(e.kind) && (e.actor === actor?.id || ['reviewer', 'partner'].includes(actor?.role));
  const n = (s) => state.log.filter((x) => x.status === s).length;
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const people = new Set(state.log.map((l) => l.event.actor));
  const shown = rows.filter(({ event: e }) => (!who || e.actor === who) && (!q || `${ACTION_WORDS[e.kind] ?? e.kind} ${e.target ?? ''} ${actorById.get(e.actor)?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const ICON = { correct: Wrench, decide: Gavel, signoff: BadgeCheck, note: MessageSquare, resolve_note: MessageSquare, revert: Undo2, view_sensitive: Eye, file: Send, client_approval: PenLine };
  const tone = (e, status) => (status === 'rejected' ? 'red' : status === 'reverted' ? '' : e.kind === 'signoff' ? 'green' : e.kind === 'view_sensitive' ? 'amber' : 'blue');

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Activity']]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <div className="cap" style={{ color: 'var(--primary)' }}>Audit trail</div>
              <h1 className="h1 mt8">Activity</h1>
              <div className="sub">Nothing is edited or deleted. An undo is a new entry, and actions the firm's rules refuse are kept with the reason.</div>
            </div>
          </div>

          <div className="stats mb24">
            <Stat label="Events recorded" value={state.log.length} sub={`${n('applied')} in effect`} icon={HistoryIcon} />
            <Stat label="People" value={people.size} sub="Recorded at least one action" icon={Users} tone="blue" />
            <Stat label="Undone" value={n('reverted')} sub="Kept in the log, not deleted" icon={Undo2} />
            <Stat label="Refused" value={n('rejected')} sub="Blocked by the firm's rules" icon={ShieldAlert} tone={n('rejected') ? 'red' : ''} />
          </div>

          <div className="card mb24" style={{ overflow: 'hidden' }}>
            <div className="card-h" style={{ flexWrap: 'wrap' }}>
              <div className="seg">
                {[['all', 'All', state.log.length], ['applied', 'Applied', n('applied')], ['reverted', 'Undone', n('reverted')], ['rejected', 'Refused', n('rejected')]].map(([k, l, c]) => (
                  <button type="button" key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}<span className="n">{c}</span></button>
                ))}
              </div>
              <div className="row" style={{ gap: 12 }}>
                <div className="search" style={{ width: 280 }}><Search size={16} /><input className="input" placeholder="Search action, item or person" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                <select className="select" style={{ width: 200 }} value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">Everyone</option>
                  {[...people].map((id) => <option key={id} value={id}>{actorById.get(id)?.name ?? id}</option>)}
                </select>
              </div>
            </div>
            {shown.length === 0 ? <Empty title="No activity yet">Corrections, decisions, notes and sign-offs appear here.</Empty> : (
              <table className="tbl tall" style={{ tableLayout: 'fixed' }}>
                <thead><tr><th>Activity</th><th style={{ width: 240 }}>Who</th><th style={{ width: 130 }}>Result</th><th className="r" style={{ width: 150 }}>When</th><th style={{ width: 110 }} /></tr></thead>
                <tbody>
                  {shown.map(({ event: e, status, reason }) => {
                    const Icon = ICON[e.kind] ?? CircleDot;
                    const d = new Date(e.at);
                    return (
                      <tr key={e.id}>
                        <td style={{ maxWidth: 1 }}>
                          <div className="row" style={{ gap: 14 }}>
                            <span className={`icotile ${tone(e, status)}`}><Icon size={18} /></span>
                            <div className="grow">
                              <div className="w6">{ACTION_WORDS[e.kind] ?? e.kind}{e.payload?.level ? ` as ${e.payload.level}` : ''}{e.batch && <span className="pill gray" style={{ marginLeft: 8 }}>Batch</span>}</div>
                              <div className="row" style={{ gap: 8, marginTop: 2, minWidth: 0 }}>
                                {e.target && (state.itemsById.get(e.target)
                                  ? <button type="button" className="target" title={state.itemsById.get(e.target).title} onClick={() => navigate('finding', { id: e.target })}>{state.itemsById.get(e.target).title}</button>
                                  : <span className="target" style={{ cursor: 'default' }}>{e.target}</span>)}
                                <span className="mono c4" style={{ flex: 'none' }}>{e.id}</span>
                              </div>
                              {reason && <div className="t12 red" style={{ marginTop: 4 }}>{reason}</div>}
                            </div>
                          </div>
                        </td>
                        <td><Person id={e.actor} role size={28} /></td>
                        <td><span className={`pill ${status === 'applied' ? 'green' : status === 'rejected' ? 'red' : 'gray'}`}>{status === 'applied' ? 'Applied' : status === 'rejected' ? 'Refused' : 'Undone'}</span></td>
                        <td className="r num"><div>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div><div className="t12 c3">{d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div></td>
                        <td className="r">{status === 'applied' && canUndo(e) && !state.filed && (
                          <button type="button" className="btn sm ghost" onClick={() => dispatch(e.batch ? { kind: 'revert', payload: { batch: e.batch } } : { kind: 'revert', target: e.id }, { label: 'Undone', undoable: false })}><Undo2 size={14} /> Undo</button>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><Eye size={16} /></span><div><div className="h3">Sensitive data views</div><div className="t12 c3">Every unmasked view of an SSN, account number or IP PIN</div></div></div></div>
            {(state.viewLog ?? []).length === 0 ? <div className="empty">No unmasked views. Staff without clearance only ever see masked values.</div>
              : state.viewLog.map((v) => <div key={v.id} className="lrow"><Person id={v.actor} role size={26} /><span className="grow" /><span className="mono c2">{v.payload.field}</span><span className="t12 c3" style={{ width: 170, textAlign: 'right' }}>{fmtDateTime(v.at)}</span></div>)}
          </div>
        </div>
      </div>
    </>
  );
}
