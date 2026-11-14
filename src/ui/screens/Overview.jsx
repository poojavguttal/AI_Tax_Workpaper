import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, Check, Minus, Plus, ArrowRight, MapPin, Users, CalendarDays, Table2, Landmark, History, PieChart } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { base, line } from '../state/base.js';
import { reduce, append, closeWith } from '../../domain/events/index.js';
import { money, signed, KIND, ACTION_WORDS, fmtDateTime } from '../format.js';
import { Kind, Person, Crumbs, Household } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';

const SLICES = [
  ['F1040.1z', 'Wages', '#4449e0'],
  ['F1040.7', 'Capital gains', '#0e7090'],
  ['Sch1.3', 'Lindqvist Studio (Schedule C)', '#36bffa'],
  ['F1040.2b', 'Interest', '#9e77ed'],
  ['F1040.3b', 'Dividends', '#f79009'],
  ['F1040.4b', 'IRA distributions', '#1d2939'],
  ['Sch1.5', 'Rental and partnerships', '#98a2b3'],
];
const short = (v) => (Math.abs(v) >= 1000 ? `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v) / 1000)}K` : money(v));

/** Total income by source, as engine v3 computed it. Losses are listed, not drawn. */
function IncomeRing({ state }) {
  const eff = new Map(state.return.lines.map((l) => [l.key, l.effective]));
  const parts = SLICES.map(([key, label, color]) => ({ key, label, color, value: eff.get(key) ?? line(key)?.value ?? 0 }));
  const total = line('F1040.9')?.value ?? parts.reduce((n, x) => n + x.value, 0);
  const drawn = parts.filter((x) => x.value > 0);
  const sum = drawn.reduce((n, x) => n + x.value, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let at = 0;
  return (
    <div className="card">
      <div className="card-h">
        <div className="row" style={{ gap: 12 }}><span className="ico"><PieChart size={17} /></span><div><div className="h3">Income breakdown</div><div className="t12 c3">Total income on Form 1040 line 9. Select a source to trace it.</div></div></div>
      </div>
      <div className="ring-wrap">
        <svg viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="Income by source">
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--hover)" strokeWidth="26" />
          {drawn.map((x) => {
            const len = (x.value / sum) * C;
            const el = <circle key={x.key} cx="100" cy="100" r={R} fill="none" stroke={x.color} strokeWidth="26" strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 100 100)" style={{ cursor: 'pointer' }} onClick={() => navigate('return', { line: x.key })}><title>{`${x.label}: ${money(x.value)}`}</title></circle>;
            at += len;
            return el;
          })}
          <text x="100" y="98" textAnchor="middle" style={{ font: '600 26px var(--font)', fill: 'var(--text)', letterSpacing: '-0.02em' }}>{short(total)}</text>
          <text x="100" y="120" textAnchor="middle" style={{ font: '400 12px var(--font)', fill: 'var(--text-3)' }}>Total income</text>
        </svg>
        <div className="legend">
          {parts.map((x) => (
            <button type="button" key={x.key} className="legend-row" onClick={() => navigate('return', { line: x.key })}>
              <span className="dot" style={{ background: x.value > 0 ? x.color : 'transparent', border: x.value > 0 ? 0 : '1.5px solid var(--border-strong)' }} />
              <span className="grow ellipsis c2">{x.label}</span>
              <span className="num w6">{money(x.value)}</span>
              <span className="num t12 c4" style={{ width: 40, textAlign: 'right' }}>{x.value > 0 ? `${Math.round((x.value / sum) * 100)}%` : 'loss'}</span>
            </button>
          ))}
          <div className="legend-row total"><span className="grow">Total income</span><span className="num">{money(total)}</span><span style={{ width: 40 }} /></div>
        </div>
      </div>
    </div>
  );
}

const FORMS = [
  { j: 'federal', code: '1040', title: 'U.S. Individual Income Tax Return', sub: 'Married filing jointly', lines: ['24', '33', '34', '37'] },
  { j: 'california', code: '540NR', title: 'California Nonresident or Part-Year Resident Income Tax Return', sub: 'Part-year resident, Jan 1 to Jul 14, 2025', lines: ['64', '78', '97', '111'] },
];
/** Form style: a refund is shown in parentheses, in green. */
const acct = (v, isBalance) => (isBalance && v < 0 ? <span className="green">({money(-v).slice(1)})</span> : money(v).slice(v < 0 ? 0 : 1));

const due = (v) => (v < 0 ? <span className="green">Refund {money(-v)}</span> : money(v));

function stages(state) {
  const step = (n) => state.steps.find((s) => s.name === n)?.done;
  const findings = state.items.filter((i) => ['error', 'conflict', 'judgment'].includes(i.kind));
  return [
    ['Preparation', findings.every((i) => i.closing)],
    ['Review', step('Reviewer sign-off')],
    ['Partner review', step('Partner sign-off')],
    ['Client approval', step('Client approval and e-file authorization')],
    ['Filed', Boolean(state.filed)],
  ];
}

export function Overview() {
  const { state, events, actor, dispatch, sinceLastSeen, markSeen } = useWorkpaper();
  const [open, setOpen] = useState({ federal: true, california: true });
  const r = state.return;
  const projected = useMemo(() => {
    const drafts = state.items.filter((i) => !i.closing && ['error', 'conflict', 'judgment'].includes(i.kind))
      .filter((i) => i.kind === 'error' || Number.isInteger(i.recommendation?.alternative))
      .map((i) => closeWith(i, { actor: 'st-01', at: new Date().toISOString(), alternative: i.recommendation?.alternative, rationale: 'preview', authority: i.recommendation?.authority ?? 'preview' }));
    return reduce(base, append(events, ...drafts)).return.effective;
  }, [events, state.items]);
  const st = stages(state);
  const current = st.findIndex(([, d]) => !d);
  const kinds = ['error', 'conflict', 'judgment', 'completeness', 'outside_filing'].map((k) => {
    const items = state.items.filter((i) => i.kind === k);
    const n = (s) => items.filter((i) => i.status === s).length;
    return { k, total: items.length, open: n('open') + n('reopened'), waiting: n('awaiting_signoff'), closed: n('closed') };
  });
  const canFile = ['reviewer', 'partner'].includes(actor?.role);

  const rows = (j) => {
    const e = r.engine[j];
    const a = r.effective[j];
    const p = projected[j];
    return [
      ['Total tax', e.total_tax, a.total_tax, p.total_tax],
      ['Payments and credits', e.payments, a.payments, p.payments],
      ['Balance due', e.balance_due, a.balance_due, p.balance_due, true],
    ];
  };

  const fig = (v) => (v < 0 ? <span className="green">{money(-v)}</span> : money(v));
  const findingsOpen = kinds.slice(0, 3).reduce((n, k) => n + k.open + k.waiting, 0);

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Overview']]} /></Header>
      <div className="content">
        <div className="hero">
          <div className="hero-top">
            <div className="hero-av"><Household size={64} /></div>
            <div className="grow">
              <h1 className="h1">Ngozi Okafor &amp; Erik Lindqvist</h1>
              <div className="row wrap mt12" style={{ gap: 10 }}>
                <span className="chip"><MapPin size={15} />Sacramento, CA → Austin, TX</span>
                <span className="chip"><Users size={15} />Married filing jointly · 2 dependents</span>
                <span className="chip"><CalendarDays size={15} />Extended to Oct 15, 2026</span>
              </div>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <button type="button" className="btn" onClick={() => navigate('return')}><Table2 size={16} />Open return</button>
              <button type="button" className="btn primary" onClick={() => navigate('queue')}>Continue review <ArrowRight size={16} /></button>
            </div>
          </div>
          <div className="hero-figs">
            <div><div className="v">{fig(r.effective.federal.balance_due)}</div><div className="cap">Federal {r.effective.federal.balance_due < 0 ? 'refund' : 'balance due'}</div></div>
            <div><div className="v">{fig(r.effective.california.balance_due)}</div><div className="cap">California {r.effective.california.balance_due < 0 ? 'refund' : 'balance due'}</div></div>
            <div><div className="v">{findingsOpen}</div><div className="cap">Findings not closed</div></div>
            <div><div className={`v ${state.blockers.length ? 'amber' : 'green'}`}>{state.blockers.length}</div><div className="cap">Filing blockers</div></div>
          </div>
        </div>

        <div className="page">
          <div className="card mb24">
            <div className="stepper">
              {st.map(([label, done], i) => (
                <div key={label} className={`st ${done ? 'done' : i === current ? 'cur' : ''}`} style={i === st.length - 1 ? { flex: 'none' } : undefined}>
                  <span className="n">{done ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
                  <span className={done ? 'c2 w5' : i === current ? 'w6' : 'c3 w5'} style={{ whiteSpace: 'nowrap' }}>{label}</span>
                  {i < st.length - 1 && <span className="line" />}
                </div>
              ))}
            </div>
          </div>

          <div className="grid-main">
            <div className="col gap20">
              <div className="card">
                <div className="card-h">
                  <div className="row" style={{ gap: 12 }}><span className="ico"><Landmark size={17} /></span><div><div className="h3">Return summary</div><div className="t12 c3">Adjusted is engine v3 plus every correction and decision recorded so far</div></div></div>
                  <span className="t12 c3">Amounts in ( ) are refunds</span>
                </div>
                <div className="card-b col gap20">
                  {FORMS.map((f) => {
                    const e = r.engine[f.j];
                    const a = r.effective[f.j];
                    const p = projected[f.j];
                    const rows = [
                      [f.lines[0], 'Total tax', e.total_tax, a.total_tax, p.total_tax],
                      [f.lines[1], 'Total payments', e.payments, a.payments, p.payments],
                      [a.balance_due < 0 ? f.lines[2] : f.lines[3], 'Amount owed or (refund)', e.balance_due, a.balance_due, p.balance_due, true],
                    ];
                    return (
                      <div key={f.j} className="tf">
                        <div className="tf-head">
                          <div className="tf-code"><span>Form</span>{f.code}</div>
                          <div className="tf-title"><div className="w6">{f.title}</div><div className="t12 c3">{f.sub}</div></div>
                          <div className="tf-year">2025</div>
                        </div>
                        <table className="tf-tbl">
                          <colgroup><col style={{ width: 52 }} /><col /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /></colgroup>
                          <thead><tr><th colSpan={2} /><th>Engine v3</th><th>Adjusted</th><th>Change</th><th>If accepted</th></tr></thead>
                          <tbody>
                            {rows.map(([ln, label, ev, av, pv, last]) => (
                              <tr key={label} className={last ? 'last' : ''}>
                                <td className="tf-ln">{ln}</td>
                                <td><div className="tf-label"><span>{label}</span><i /></div></td>
                                <td className="tf-amt">{acct(ev, last)}</td>
                                <td className="tf-amt adj">{acct(av, last)}</td>
                                <td className="tf-amt c3">{av === ev ? '—' : signed(av - ev)}</td>
                                <td className="tf-amt">{acct(pv, last)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              </div>

              <IncomeRing state={state} />

              <div className="card">
                <div className="card-h">
                  <div className="row" style={{ gap: 12 }}><span className="ico"><History size={17} /></span><div><div className="h3">Since you last looked</div><div className="t12 c3">{sinceLastSeen.events.length ? `${sinceLastSeen.events.length} new events` : 'No new activity'}</div></div></div>
                  {sinceLastSeen.events.length > 0 && <button type="button" className="btn sm" onClick={markSeen}>Mark as seen</button>}
                </div>
                {Object.keys(sinceLastSeen.totals).length > 0 && (
                  <div className="row wrap" style={{ padding: '16px 24px 0' }}>
                    {Object.entries(sinceLastSeen.totals).map(([k, v]) => <span key={k} className="pill outline">{k.replace('.', ' ').replace(/_/g, ' ')} <b className="num">{signed(v)}</b></span>)}
                  </div>
                )}
                {sinceLastSeen.events.length === 0 ? <div className="empty">You're up to date.</div> : (
                  <div style={{ padding: '8px 0' }}>
                    {sinceLastSeen.events.slice(-8).reverse().map((e) => (
                      <div key={e.id} className="lrow" style={{ borderTop: 0, padding: '10px 24px' }}>
                        <Person id={e.actor} size={26} />
                        <span className="c3 grow ellipsis">{ACTION_WORDS[e.kind]}{e.target ? ` · ${e.target}` : ''}</span>
                        <span className="t12 c4 num">{fmtDateTime(e.at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="col gap20">
              <div className="card">
                <div className="card-h">
                  <div><div className="h3">Review status</div><div className="t12 c3">Nothing closes without a recorded decision</div></div>
                  <a className="link t12" style={{ whiteSpace: 'nowrap' }} href="#/queue">Open review</a>
                </div>
                {kinds.map(({ k, total, open: o, waiting, closed }) => (
                  <div key={k} className="lrow click" style={{ display: 'block', padding: '16px 24px' }} onClick={() => navigate('queue', { kind: k })}>
                    <div className="between">
                      <Kind kind={k} />
                      <span className="num"><b>{o}</b><span className="c3"> open</span>{waiting > 0 && <span className="amber"> · {waiting} waiting</span>}<span className="c4"> · {closed}/{total} closed</span></span>
                    </div>
                    <div className="bar mt12"><span style={{ width: `${(closed / total) * 100}%`, background: 'var(--green)' }} /><span style={{ width: `${(waiting / total) * 100}%`, background: '#f79009' }} /></div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-h">
                  <div><div className="h3">Filing gate</div><div className={`t12 ${state.blockers.length ? 'amber' : 'green'}`}>{state.blockers.length ? `${state.blockers.length} blockers remain` : 'Nothing blocks filing'}</div></div>
                  {actor?.kind === 'client'
                    ? <button type="button" className="btn primary sm" onClick={() => dispatch({ kind: 'client_approval', target: 'return' }, { label: 'Return approved and e-file authorized' })}>Approve and sign 8879</button>
                    : <button type="button" className="btn primary sm" disabled={!state.canFile || !canFile} title={!canFile ? 'Only a reviewer or partner files' : ''}
                      onClick={() => dispatch({ kind: 'file', target: 'return' }, { label: 'Return filed and frozen', undoable: false })}>{state.filed ? 'Filed' : 'File return'}</button>}
                </div>
                {state.steps.map((s) => (
                  <div key={s.name} className="lrow" style={{ padding: '12px 24px' }}>
                    {s.done ? <CheckCircle2 size={18} className="green" /> : <Circle size={18} style={{ color: 'var(--border-strong)' }} />}
                    <span className={`grow ${s.done ? 'c3' : ''}`}>{s.name}</span>
                    {s.derived ? <span className="t12 c4">Automatic</span>
                      : !s.done && actor?.kind === 'staff' ? <button type="button" className="btn sm ghost" onClick={() => dispatch({ kind: 'complete_step', target: s.name, payload: { evidence: [] } }, { label: `${s.name}: done` })}>Mark done</button> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
