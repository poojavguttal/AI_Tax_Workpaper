// Firm: status across returns, search, staff and roles, firm standards, time against budget.

import { useState } from 'react';
import { Search, Timer, Users, Scale, Building2, Lock, ShieldCheck } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { packet, actorById, linesOf } from '../state/base.js';
import { money, fmtDate, fmtDateTime, ROLE_LABEL } from '../format.js';
import { Crumbs, Person, Stat, Avatar } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';

const raw = packet.raw;
const AREAS = raw.firm.budget_hours;
const area = (k) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const STANDARD_LABEL = { partner_threshold: ['Partner sign-off above', (v) => money(v), 'Tax effect, federal or state'], variance_percent: ['Prior-year variance flag', (v) => `${v}%`, 'Change from last year, percent'], variance_amount: ['…and over', (v) => money(v), 'Change from last year, dollars'] };

export function Firm({ params }) {
  const { state, dispatch, actor } = useWorkpaper();
  const tab = params.tab ?? 'status';
  const [q, setQ] = useState(params.q ?? '');
  const isAdmin = actor?.role === 'firm_administrator';
  const logged = (a) => state.time.filter((t) => t.payload.area === a).reduce((s, t) => s + t.payload.hours, 0);
  const totalBudget = Object.values(AREAS).reduce((s, v) => s + v, 0);
  const totalLogged = state.time.reduce((s, t) => s + t.payload.hours, 0);
  const openFindings = state.items.filter((i) => ['error', 'conflict', 'judgment', 'adjustment'].includes(i.kind) && i.status !== 'closed').length;
  const status = state.filed ? (state.amendment ? 'Amendment open' : 'Filed') : state.canFile ? 'Ready to file' : state.extensions.length ? 'Extended · in review' : 'In review';

  const TABS = [['status', 'Status and search'], ['staff', 'Staff and roles'], ['standards', 'Standards'], ['time', 'Time and budget']];
  return (
    <>
      <Header><Crumbs items={[[raw.firm.name], ['Firm']]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <div className="cap" style={{ color: 'var(--primary)' }}>{raw.firm.name}</div>
              <h1 className="h1 mt8">Firm</h1>
              <div className="sub">Firm-wide standards the reducer enforces, who may do what, sensitive-data protection, and time against budget.</div>
            </div>
          </div>
          <div className="stats mb24">
            <Stat label="Returns" value={1} sub={status} icon={Building2} />
            <Stat label="Staff" value={raw.firm.staff.length} sub={`${raw.firm.staff.filter((s) => !s.sensitive_data_clearance).length} without clearance`} icon={Users} />
            <Stat label="Hours logged" value={totalLogged.toFixed(1)} sub={`of ${totalBudget} budgeted`} icon={Timer} tone={totalLogged > totalBudget ? 'red' : ''} />
            <Stat label="Unmasked views" value={state.viewLog.length} sub="Every one logged" icon={Lock} onClick={() => navigate('history')} />
          </div>
          <div className="sch-tabs mb24">{TABS.map(([k, l]) => <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => navigate('firm', { tab: k })}>{l}</button>)}</div>

          {tab === 'status' && (
            <>
              <div className="card mb24" style={{ overflow: 'hidden' }}>
                <table className="tbl tall">
                  <thead><tr><th>Client</th><th style={{ width: 160 }}>Status</th><th style={{ width: 130 }} className="r">Open findings</th><th style={{ width: 130 }} className="r">Blockers</th><th style={{ width: 160 }} className="r">Hours / budget</th><th style={{ width: 150 }}>Due</th><th style={{ width: 200 }}>Team</th></tr></thead>
                  <tbody>
                    <tr className="click" onClick={() => navigate('overview')}>
                      <td><div className="w6">Okafor-Lindqvist</div><div className="t12 c3">2025 · 1040 + 540NR</div></td>
                      <td><span className={`pill ${state.filed ? 'green' : state.canFile ? 'blue' : 'amber'}`}>{status}</span></td>
                      <td className="r num">{openFindings}</td><td className="r num">{state.blockers.length}</td>
                      <td className="r num">{totalLogged.toFixed(1)} / {totalBudget}</td><td>{fmtDate('2026-10-15')}</td>
                      <td><div className="row" style={{ gap: -6 }}>{Object.values(raw.firm.assignment_at_start).map((id) => <Avatar key={id} id={id} size={26} />)}</div></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <GlobalSearch q={q} setQ={setQ} />
            </>
          )}

          {tab === 'staff' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl tall">
                <thead><tr><th>Person</th><th style={{ width: 170 }}>Role</th><th style={{ width: 150 }}>Active from</th><th style={{ width: 200 }}>Sensitive data</th><th style={{ width: 150 }} className="r">Assigned</th><th style={{ width: 150 }} className="r">Actions recorded</th></tr></thead>
                <tbody>
                  {raw.firm.staff.map((s) => (
                    <tr key={s.id}>
                      <td><div className="row" style={{ gap: 12 }}><Avatar id={s.id} size={32} /><div><div className="w6">{s.name}{s.credential ? `, ${s.credential}` : ''}</div>{s.note && <div className="t12 c3">{s.note}</div>}</div></div></td>
                      <td>{ROLE_LABEL[s.role]}</td>
                      <td>{fmtDate(s.active_from)}{s.active_from > new Date().toISOString().slice(0, 10) && <div className="t12 amber">Not active yet</div>}</td>
                      <td>{s.sensitive_data_clearance ? <span className="pill green"><ShieldCheck size={12} /> Cleared</span> : <span className="pill amber"><Lock size={12} /> Masked</span>}</td>
                      <td className="r num">{Object.values(state.assignments).filter((a) => a.payload.to === s.id).length}</td>
                      <td className="r num">{state.log.filter((l) => l.event.actor === s.id && l.status === 'applied').length}</td>
                    </tr>
                  ))}
                  {raw.firm.client_users.map((c) => (
                    <tr key={c.id}><td><div className="row" style={{ gap: 12 }}><Avatar id={c.id} size={32} /><div className="w6">{c.name}</div></div></td><td>Client</td><td className="c3">—</td><td className="c3">Own data only</td><td className="r c3">—</td><td className="r num">{state.log.filter((l) => l.event.actor === c.id && l.status === 'applied').length}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="t12 c3" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>Roles come from this list, never from the event, so nobody can claim a role. Firm identity: EFIN {raw.firm.firm_identity.efin} · EIN {raw.firm.firm_identity.ein}.</div>
            </div>
          )}

          {tab === 'standards' && <Standards isAdmin={isAdmin} />}

          {tab === 'time' && (
            <div className="grid-main">
              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="tbl tall">
                  <thead><tr><th>Area</th><th className="r" style={{ width: 110 }}>Budget</th><th className="r" style={{ width: 110 }}>Logged</th><th style={{ width: 260 }}>Used</th></tr></thead>
                  <tbody>
                    {Object.entries(AREAS).map(([k, b]) => {
                      const h = logged(k); const pct = Math.min(100, (h / b) * 100);
                      return (
                        <tr key={k}>
                          <td className="w5">{area(k)}</td><td className="r num">{b.toFixed(1)}</td><td className={`r num ${h > b ? 'red w6' : ''}`}>{h.toFixed(1)}</td>
                          <td><div className="bar"><span style={{ width: `${pct}%`, background: h > b ? 'var(--red)' : h > b * 0.8 ? '#f59e0b' : 'var(--primary)' }} /></div></td>
                        </tr>
                      );
                    })}
                    <tr className="tot"><td className="w6">Total</td><td className="r num w6">{totalBudget.toFixed(1)}</td><td className="r num w6">{totalLogged.toFixed(1)}</td><td /></tr>
                  </tbody>
                </table>
              </div>
              <LogTime />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Standards({ isAdmin }) {
  const { state, dispatch } = useWorkpaper();
  const std = raw.firm.starter_standards;
  const [edit, setEdit] = useState(null);
  const [val, setVal] = useState('');
  const [why, setWhy] = useState('');
  const history = state.log.filter((l) => l.event.kind === 'set_standard' && l.status === 'applied');
  return (
    <div className="grid-main">
      <div className="col gap16">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><Scale size={16} /></span><div><div className="h3">Enforced thresholds</div><div className="t12 c3">{isAdmin ? 'You can change these; every change is recorded' : 'Only the firm administrator changes these'}</div></div></div></div>
          <table className="tbl tall"><tbody>
            {Object.entries(STANDARD_LABEL).map(([k, [l, fmt, sub]]) => (
              <tr key={k}>
                <td><div className="w5">{l}</div><div className="t12 c3">{sub}</div></td>
                <td className="r num w6" style={{ width: 140 }}>{fmt(state.standards[k])}</td>
                <td style={{ width: 360 }}>
                  {edit === k ? (
                    <div className="row" style={{ gap: 6 }}>
                      <input className="input" style={{ width: 90 }} value={val} onChange={(e) => setVal(e.target.value)} />
                      <input className="input grow" placeholder="Why" value={why} onChange={(e) => setWhy(e.target.value)} />
                      <button type="button" className="btn sm primary" disabled={!why || !(Number(val) > 0)} onClick={() => { dispatch({ kind: 'set_standard', target: k, payload: { value: Number(val), reason: why } }, { label: `${l} set to ${fmt(Number(val))}` }); setEdit(null); setWhy(''); }}>Save</button>
                    </div>
                  ) : isAdmin ? <button type="button" className="btn sm" onClick={() => { setEdit(k); setVal(String(state.standards[k])); }}>Change</button> : null}
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div className="card"><div className="card-h"><div className="h3">Firm rules</div></div><ul className="sch-list" style={{ padding: '16px 24px 16px 40px' }}>{std.rules.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="card"><div className="card-h"><div className="h3">Required steps before filing</div><span className="t12 c3">{std.required_steps.length}</span></div><ol className="sch-list" style={{ padding: '16px 24px 16px 40px' }}>{std.required_steps.map((r) => <li key={r}>{r}{state.steps.find((s) => s.name === r)?.done ? ' ✓' : ''}</li>)}</ol></div>
      </div>
      <div className="col gap16">
        <div className="card"><div className="card-h"><div className="h3">Verification types</div></div><div className="card-b row wrap" style={{ gap: 6 }}>{std.verification_types.map((v) => <span key={v} className="pill outline">{v.replace(/_/g, ' ')}</span>)}</div></div>
        <div className="card"><div className="card-h"><div className="h3">Changes to standards</div></div>
          {history.length === 0 ? <div className="card-b t13 c3">None. Starting values come from the firm's starter standards.</div> : history.map((l) => <div key={l.event.id} className="lrow"><Person id={l.event.actor} size={22} /><div className="grow"><div className="t13">{STANDARD_LABEL[l.event.target]?.[0]} → {STANDARD_LABEL[l.event.target]?.[1](l.event.payload.value)}</div><div className="t12 c3">{l.event.payload.reason} · {fmtDateTime(l.event.at)}</div></div></div>)}
        </div>
      </div>
    </div>
  );
}

function LogTime() {
  const { state, dispatch, actor } = useWorkpaper();
  const [a, setA] = useState(Object.keys(AREAS)[0]);
  const [h, setH] = useState('');
  const [note, setNote] = useState('');
  const mine = state.time.slice(-8).reverse();
  return (
    <div className="card">
      <div className="card-h"><div className="h3">Log time</div></div>
      <div className="card-b col gap12">
        <select className="select" value={a} onChange={(e) => setA(e.target.value)}>{Object.keys(AREAS).map((k) => <option key={k} value={k}>{area(k)}</option>)}</select>
        <div className="row" style={{ gap: 8 }}><input className="input" style={{ width: 100 }} placeholder="Hours" value={h} onChange={(e) => setH(e.target.value)} /><input className="input grow" placeholder="What you did" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button type="button" className="btn primary" disabled={actor?.kind !== 'staff' || !(Number(h) > 0)} onClick={() => { dispatch({ kind: 'log_time', target: 'return', payload: { area: a, hours: Number(h), note } }, { label: `${h} h logged to ${area(a).toLowerCase()}` }); setH(''); setNote(''); }}>Log {h || 0} hours</button>
      </div>
      {mine.map((t) => <div key={t.id} className="lrow" style={{ padding: '10px 20px' }}><Person id={t.actor} size={20} /><span className="t13 grow">{area(t.payload.area)}{t.payload.note ? ` · ${t.payload.note}` : ''}</span><span className="num w6">{t.payload.hours}h</span></div>)}
    </div>
  );
}

function GlobalSearch({ q, setQ }) {
  const { state } = useWorkpaper();
  const s = q.trim().toLowerCase();
  const hit = (t) => String(t ?? '').toLowerCase().includes(s);
  const items = s ? state.items.filter((i) => hit(i.title) || hit(i.id)).slice(0, 8) : [];
  const docs = s ? packet.documents.filter((d) => hit(d.title) || hit(d.id) || hit(d.issuer)).slice(0, 8) : [];
  const lines = s ? linesOf().filter((l) => hit(l.key) || hit(l.label)).slice(0, 8) : [];
  const evs = s ? state.log.filter((l) => hit(l.event.payload?.text) || hit(l.event.payload?.rationale) || hit(l.event.payload?.reason)).slice(0, 6) : [];
  const Group = ({ title, rows }) => rows.length > 0 && <div className="mb16"><div className="cap mb8">{title}</div><div className="card">{rows}</div></div>;
  return (
    <div>
      <div className="search mb16" style={{ maxWidth: 560 }}><Search size={16} /><input className="input" placeholder="Search findings, documents, return lines, notes and decisions" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      {s && items.length + docs.length + lines.length + evs.length === 0 && <div className="c3">Nothing matches “{q}”.</div>}
      <Group title="Findings" rows={items.map((i) => <div key={i.id} className="lrow click" onClick={() => navigate('finding', { id: i.id })}><span className="grow ellipsis">{i.title}</span><span className="t12 c3">{i.status.replace('_', ' ')}</span></div>)} />
      <Group title="Documents" rows={docs.map((d) => <div key={d.id} className="lrow click" onClick={() => navigate('document', { id: d.id })}><span className="mono t12 c3" style={{ width: 40 }}>{d.id}</span><span className="grow ellipsis">{d.title}</span></div>)} />
      <Group title="Return lines" rows={lines.map((l) => <div key={l.key} className="lrow click" onClick={() => navigate('return', { line: l.key })}><span className="mono t12 c3" style={{ width: 150 }}>{l.key}</span><span className="grow ellipsis">{l.label}</span></div>)} />
      <Group title="Notes and decisions" rows={evs.map((l) => <div key={l.event.id} className="lrow"><Person id={l.event.actor} size={20} /><span className="grow ellipsis">{l.event.payload.text ?? l.event.payload.rationale ?? l.event.payload.reason}</span></div>)} />
    </div>
  );
}
