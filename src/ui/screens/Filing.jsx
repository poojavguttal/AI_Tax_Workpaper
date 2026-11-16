// Filing and after: extension, transmission, e-file acknowledgements, amendment on
// top of the filed return, the client's copy and notice responses.

import { useState } from 'react';
import { Send, CheckCircle2, Circle, XCircle, Clock3, FilePlus2, Printer, Mail, ShieldCheck, Lock, AlertTriangle } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { packet, actorById, line as lineOf } from '../state/base.js';
import { money, signed, fmtDate, fmtDateTime, lineValue, ACTION_WORDS } from '../format.js';
import { Crumbs, Person, Empty } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';

const raw = packet.raw;
const EXT = raw.what_if.extension;
const AGENCY_EFILE = raw.tax_agency_records.efile;
const JUR = { federal: 'Federal', california: 'California' };
const owe = (n) => (n < 0 ? `${money(-n)} refund` : `${money(n)} owed`);

/** Where the return stands, step by step. */
function pipeline(state) {
  const items = state.blockers.filter((b) => b.type === 'item').length;
  const signed = (lv) => state.returnSignoffs.some((s) => s.valid && s.payload.level === lv);
  const approved = state.approvals.some((a) => a.valid);
  const accepted = (j) => state.filed?.acks.some((a) => a.payload.jurisdiction === j && a.payload.status === 'accepted');
  return [
    ['Findings', items === 0, items ? `${items} open` : 'All closed'],
    ['Reviewer', signed('reviewer'), 'Return sign-off'],
    ['Partner', signed('partner'), 'Return sign-off'],
    ['Client', approved, 'Approval and 8879'],
    ['Transmitted', Boolean(state.filed), state.filed ? fmtDate(state.filed.at) : 'Not yet'],
    ['IRS', accepted('federal'), accepted('federal') ? 'Accepted' : 'Waiting'],
    ['FTB', accepted('california'), accepted('california') ? 'Accepted' : 'Waiting'],
  ];
}

export function Filing() {
  const { state, dispatch, actor } = useWorkpaper();
  const canFile = ['reviewer', 'partner'].includes(actor?.role);
  const steps = pipeline(state);
  const last = state.filings.at(-1);
  const pendingAck = state.filed && ['federal', 'california'].filter((j) => !state.filed.acks.some((a) => a.payload.jurisdiction === j));
  const [ackJ, setAckJ] = useState('federal');
  const [ackStatus, setAckStatus] = useState('accepted');
  const agencyHint = AGENCY_EFILE.find((x) => x.jurisdiction === ackJ && (state.filings.length > 1 || x.status !== 'accepted' ? true : false) && x.status !== 'not_transmitted');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const fillRejection = () => { const r = AGENCY_EFILE.find((x) => x.status === 'rejected'); setAckJ(r.jurisdiction); setAckStatus('rejected'); setCode(r.errors[0].code); setMessage(r.errors[0].message); };

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Filing']]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <h1 className="h1">Filing</h1>
              <div className="sub">Extension, transmission and the agencies' answers. Filing freezes the return; anything later goes on an amendment built on top of the filed version.</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => navigate('copy')}><Printer size={15} /> Client's copy</button>
            </div>
          </div>

          <div className="pipe mb24">
            {steps.map(([l, done, sub], k) => (
              <div key={l} className={`pipe-step ${done ? 'done' : ''} ${!done && steps.slice(0, k).every((s) => s[1]) ? 'now' : ''}`}>
                {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                <div><div className="t13 w6">{l}</div>{sub && <div className="t12 c3">{sub}</div>}</div>
              </div>
            ))}
          </div>

          <div className="grid-2 mb24">
            <div className="card">
              <div className="card-h"><div><div className="h3">Extension</div><div className="t12 c3">Form 4868 and FTB 3519 · original due date Apr 15, 2026</div></div>{state.extensions.length > 0 && <span className="pill green">On file</span>}</div>
              <div className="card-b">
                <table className="tbl" style={{ tableLayout: 'fixed' }}>
                  <thead><tr><th>Jurisdiction</th><th className="r" style={{ width: 130 }}>Paid with it</th><th style={{ width: 150 }}>Recorded</th></tr></thead>
                  <tbody>
                    {['federal', 'california'].map((j) => {
                      const e = EXT[j]; const rec = state.extensions.find((x) => x.payload.jurisdiction === j);
                      const paid = j === 'federal' ? e.paid_with_form_4868 : e.paid_with_ftb_3519;
                      return (
                        <tr key={j}>
                          <td><div className="w5">{JUR[j]} · {j === 'federal' ? 'Form 4868' : 'FTB 3519'}</div><div className="t12 c3">Estimated tax {money(e.estimated_total_tax)} · payments {money(e.payments)}</div></td>
                          <td className="r num w6">{money(paid)}</td>
                          <td>{rec ? <div className="t12" style={{ whiteSpace: 'nowrap' }}><div className="w5">{fmtDate(rec.at)}</div><div className="c3">{actorById.get(rec.actor)?.name}</div></div>
                            : canFile && !state.filings.length ? <button type="button" className="btn sm" onClick={() => dispatch({ kind: 'extend', target: 'return', payload: { jurisdiction: j, payment: paid, form: j === 'federal' ? '4868' : 'FTB 3519', based_on: EXT.based_on_version } }, { label: `${JUR[j]} extension recorded` })}>Record</button>
                              : <span className="t12 c4">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="t12 c3 mt12">Estimated from engine {EXT.based_on_version} on {fmtDate(EXT.computed_at)}; {EXT.federal.rule}. Extended due date Oct 15, 2026.</div>
              </div>
            </div>

            <div className="card">
              <div className="card-h"><div><div className="h3">Transmit</div><div className="t12 c3">Server-side rule: only a reviewer or partner, only with zero blockers</div></div>{state.filed ? <span className="pill green"><Lock size={12} /> Frozen</span> : state.amendment ? <span className="pill amber">Amendment open</span> : null}</div>
              <div className="card-b col gap12">
                {!state.filed || state.amendment ? (
                  <>
                    <div className="row" style={{ gap: 10 }}>
                      {state.canFile ? <CheckCircle2 size={18} className="green" /> : <AlertTriangle size={18} className="amber" />}
                      <span>{state.canFile ? `Ready to transmit the ${state.amendment ? 'amended' : 'original'} return` : `${state.blockers.length} blockers remain`}</span>
                      {!state.canFile && <button type="button" className="linkish t13" onClick={() => navigate('overview')}>See blockers</button>}
                    </div>
                    <div className="row" style={{ gap: 12 }}>
                      <div className="fig-mini"><span className="cap">Federal</span><b>{owe(state.return.effective.federal.balance_due)}</b></div>
                      <div className="fig-mini"><span className="cap">California</span><b>{owe(state.return.effective.california.balance_due)}</b></div>
                    </div>
                    <button type="button" className="btn primary" disabled={!canFile} title={!canFile ? 'Only a reviewer or partner transmits' : ''} onClick={() => dispatch({ kind: 'file', target: 'return' }, { label: state.amendment ? 'Amended return transmitted' : 'Return transmitted and frozen', undoable: false })}><Send size={15} /> Transmit {state.amendment ? '1040-X and 540NR amended' : '1040 and 540NR'}</button>
                  </>
                ) : (
                  <>
                    <div className="row" style={{ gap: 10 }}><ShieldCheck size={18} className="green" /><span>{state.filed.type === 'amended' ? 'Amended return' : 'Return'} transmitted {fmtDateTime(state.filed.at)} by {actorById.get(state.filed.actor)?.name}</span></div>
                    <div className="t12 c3 mono">Content hash {state.filed.hash.slice(0, 16)}…</div>
                    {pendingAck.length > 0 && canFile && (
                      <div className="ack-box">
                        <div className="between"><span className="w6 t13">Record the agency's answer</span><button type="button" className="linkish t12" onClick={fillRejection}>Use the packet's rejection</button></div>
                        <div className="row mt8" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <select className="select" style={{ width: 150 }} value={ackJ} onChange={(e) => setAckJ(e.target.value)}>{pendingAck.map((j) => <option key={j} value={j}>{JUR[j]}</option>)}</select>
                          <div className="seg">{['accepted', 'rejected'].map((s) => <button type="button" key={s} className={ackStatus === s ? 'on' : ''} onClick={() => setAckStatus(s)}>{s === 'accepted' ? 'Accepted' : 'Rejected'}</button>)}</div>
                        </div>
                        {ackStatus === 'rejected' && <div className="col gap8 mt8"><input className="input" placeholder="Error code, e.g. R0000-504-02" value={code} onChange={(e) => setCode(e.target.value)} /><input className="input" placeholder="Agency message" value={message} onChange={(e) => setMessage(e.target.value)} /></div>}
                        <button type="button" className="btn sm primary mt8" onClick={() => dispatch({ kind: 'efile_ack', target: 'return', payload: { jurisdiction: pendingAck.includes(ackJ) ? ackJ : pendingAck[0], status: ackStatus, ...(ackStatus === 'rejected' ? { code, message } : {}), submission_id: agencyHint?.submission_id } }, { label: ackStatus === 'rejected' ? 'Rejection recorded: the return is open to fix and resend' : 'Acceptance recorded', undoable: false })}>Record</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {state.filings.length > 0 && (
            <div className="card mb24" style={{ overflow: 'hidden' }}>
              <div className="card-h"><div className="h3">Submissions</div><span className="t12 c3">{state.filings.length}</span></div>
              <table className="tbl tall">
                <thead><tr><th>Submission</th><th style={{ width: 220 }}>By</th><th style={{ width: 170 }} className="r">Federal</th><th style={{ width: 170 }} className="r">California</th><th style={{ width: 320 }}>Agency answers</th></tr></thead>
                <tbody>
                  {state.filings.map((f, k) => (
                    <tr key={f.id}>
                      <td><div className="w6">{f.type === 'amended' ? 'Amended return (1040-X, 540NR amended)' : `Original return${k ? ' (resent)' : ''}`}</div><div className="t12 c3">{fmtDateTime(f.at)} · <span className="mono">{f.hash.slice(0, 12)}</span></div></td>
                      <td><Person id={f.actor} role /></td>
                      <td className="r num">{owe(f.return.effective.federal.balance_due)}</td>
                      <td className="r num">{owe(f.return.effective.california.balance_due)}</td>
                      <td>
                        {f.acks.length === 0 ? <span className="pill outline"><Clock3 size={12} /> Waiting</span> : f.acks.map((a) => (
                          <div key={a.id} className="row t12" style={{ gap: 6, marginBottom: 4 }}>
                            {a.payload.status === 'accepted' ? <CheckCircle2 size={14} className="green" /> : <XCircle size={14} className="red" />}
                            <span className="w5">{JUR[a.payload.jurisdiction]} {a.payload.status}</span>
                            {a.payload.code && <span className="mono c3" title={a.payload.message}>{a.payload.code}</span>}
                          </div>
                        ))}
                        {f.rejected && <div className="t12 red">{f.rejected.payload.message}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Amendment canFile={canFile} reason={reason} setReason={setReason} />
          <Notices />
        </div>
      </div>
    </>
  );
}

// ── Amendment ───────────────────────────────────────────────────────────────

function Amendment({ canFile, reason, setReason }) {
  const { state, dispatch } = useWorkpaper();
  const filed = [...state.filings].reverse().find((f) => !f.rejected && f.acks.some((a) => a.payload.status === 'accepted'));
  if (!filed && !state.amendment) return null;
  const base = state.amendment ? state.filings.filter((f) => !f.rejected).at(-1) : filed;
  const rows = [['federal', 'total_tax', 'Federal total tax'], ['federal', 'payments', 'Federal payments'], ['federal', 'balance_due', 'Federal amount owed or (refund)'], ['california', 'total_tax', 'California total tax'], ['california', 'payments', 'California payments'], ['california', 'balance_due', 'California amount owed or (refund)']];
  const filedLines = new Map(base.return.lines.map((l) => [l.key, l.effective]));
  const changed = state.return.lines.filter((l) => filedLines.get(l.key) !== l.effective);
  return (
    <div className="card mb24">
      <div className="card-h">
        <div><div className="h3">Amendment</div><div className="t12 c3">Built on top of the filed return; the filed version stays exactly as it was</div></div>
        {state.amendment ? <span className="pill amber">Open · {state.amendment.payload.reason}</span> : null}
      </div>
      {!state.amendment ? (
        <div className="card-b row" style={{ gap: 8 }}>
          <input className="input grow" placeholder="Why the return is being amended (e.g. response to IRS Letter 566)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn" disabled={!canFile || !reason} onClick={() => { dispatch({ kind: 'amend', target: 'return', payload: { reason } }, { label: 'Amendment opened: changes are allowed again' }); setReason(''); }}><FilePlus2 size={15} /> Open amendment</button>
        </div>
      ) : (
        <div className="card-b">
          <div className="tf sheet-form">
            <div className="tf-head"><div className="tf-code"><span>Form</span>1040-X</div><div className="tf-title"><div className="w6">Amended return: as filed, net change, corrected</div><div className="t12 c3">Corrections and decisions recorded since the amendment opened flow in here; it needs fresh sign-offs and client approval</div></div><div className="tf-year">2025</div></div>
            <table className="tf-tbl">
              <colgroup><col /><col style={{ width: 170 }} /><col style={{ width: 150 }} /><col style={{ width: 170 }} /></colgroup>
              <thead><tr><th style={{ textAlign: 'left', paddingLeft: 14 }}>Line</th><th>A · As filed</th><th>B · Net change</th><th>C · Corrected</th></tr></thead>
              <tbody>
                {rows.map(([j, k, l]) => {
                  const a = base.return.effective[j][k]; const c = state.return.effective[j][k];
                  return <tr key={l} className={k === 'balance_due' ? 'last' : ''}><td><div className="tf-label"><span>{l}</span><i /></div></td><td className="tf-amt c3">{money(a)}</td><td className={`tf-amt ${c - a ? 'w6' : 'c4'}`}>{signed(c - a)}</td><td className="tf-amt adj">{money(c)}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="t13 mt16 w6">Lines changed since filing ({changed.length})</div>
          {changed.length === 0 ? <div className="t13 c3 mt8">Nothing yet. Record a correction, decision or adjustment on a finding or a return line.</div> : (
            <div className="mt8">{changed.map((l) => <div key={l.key} className="lrow click" style={{ padding: '8px 0' }} onClick={() => navigate('return', { line: l.key })}><span className="mono t12" style={{ width: 160 }}>{l.key}</span><span className="t13 grow ellipsis">{lineOf(l.key)?.label}</span><span className="num c3 strike">{lineValue(filedLines.get(l.key) ?? l.engine, l.key)}</span><span className="num green w6">{lineValue(l.effective, l.key)}</span></div>)}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Notices ─────────────────────────────────────────────────────────────────

// Which return lines each notice puts in question.
export const NOTICE_LINES = { 'N-2025-L566': ['SchA.12', 'F8283.A1.stock', 'F8283.A1.vehicle', 'SchC.1'] };

function Notices() {
  const { state } = useWorkpaper();
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-h"><div><div className="h3">Notices</div><div className="t12 c3">Each response is a self-contained record: the notice, the lines as filed, the evidence, and who decided what</div></div></div>
      <table className="tbl tall">
        <thead><tr><th>Notice</th><th style={{ width: 120 }}>Tax year</th><th style={{ width: 140 }}>Dated</th><th style={{ width: 150 }}>Respond by</th><th style={{ width: 220 }}>Status</th></tr></thead>
        <tbody>
          {raw.tax_agency_records.notices.map((n) => {
            const resp = state.noticeResponses.find((r) => r.target === n.id);
            return (
              <tr key={n.id} className="click" onClick={() => navigate('notice', { id: n.id })}>
                <td><div className="w6">{n.agency} {n.type}</div><div className="t12 c3 ellipsis" style={{ maxWidth: 520 }}>{n.summary ?? n.items_under_examination?.join(' ')}</div></td>
                <td>{n.tax_year}</td><td>{fmtDate(n.dated)}</td><td>{n.response_due ? fmtDate(n.response_due) : '—'}</td>
                <td>{resp ? <span className="pill green">Answered {fmtDate(resp.at)}</span> : n.status ? <span className="pill outline ellipsis" style={{ maxWidth: 200 }} title={n.status}>{n.status.split(':')[0]}</span> : <span className="pill amber">Open</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Notice({ params }) {
  const { state, dispatch, actor, openTrace } = useWorkpaper();
  const n = raw.tax_agency_records.notices.find((x) => x.id === params.id);
  const [text, setText] = useState('');
  if (!n) return <><Header><Crumbs items={[['Filing', ['filing']], ['Not found']]} /></Header><Empty title="No such notice" /></>;
  const keys = NOTICE_LINES[n.id] ?? [];
  const filed = state.filings.filter((f) => !f.rejected).at(-1);
  const filedLines = new Map((filed?.return.lines ?? []).map((l) => [l.key, l.effective]));
  const items = state.items.filter((i) => i.lines.some((k) => keys.includes(k.split('|')[1]) || keys.some((x) => k.split('|')[1].startsWith(`${x.split('.')[0]}.`) && x.split('.')[0] === 'F8283')));
  const docs = [...new Set(keys.flatMap((k) => lineOf(k)?.sources ?? []).map((s) => packet.index.observations.get(s)?.doc_id).filter(Boolean))];
  const events = state.log.filter((l) => items.some((i) => i.id === l.event.target) && l.status === 'applied');
  const resp = state.noticeResponses.find((r) => r.target === n.id);
  const defaultText = n.items_under_examination ? `In response to ${n.type} dated ${fmtDate(n.dated)}, enclosed for each item under examination: the return lines as filed, the source documents, and the firm's recorded review (decisions, sign-offs and dates). The filed return is identified by content hash ${filed?.hash.slice(0, 16) ?? '(not yet filed)'}.` : '';
  return (
    <>
      <Header><Crumbs items={[['Filing', ['filing']], [`${n.agency} ${n.type}`]]} /></Header>
      <div className="content">
        <div className="page notice-page">
          <div className="page-head">
            <div>
              <div className="cap" style={{ color: 'var(--primary)' }}>Notice response record</div>
              <h1 className="h1 mt8">{n.agency} {n.type} · tax year {n.tax_year}</h1>
              <div className="sub">Dated {fmtDate(n.dated)}{n.response_due ? ` · respond by ${fmtDate(n.response_due)}` : ''} · {n.document}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => openTrace({ ref: n.document })}>Open {n.document}</button>
              <button type="button" className="btn" onClick={() => window.print()}><Printer size={15} /> Print record</button>
            </div>
          </div>

          <div className="card mb16"><div className="card-h"><div className="h3">1 · What the agency asks</div></div>
            <div className="card-b">{n.summary && <p className="t13" style={{ margin: 0 }}>{n.summary}</p>}{n.status && <p className="t13 c2">{n.status}</p>}
              {n.items_under_examination && <ol className="sch-list">{n.items_under_examination.map((x) => <li key={x}>{x}</li>)}</ol>}</div></div>

          {keys.length > 0 && (
            <div className="card mb16" style={{ overflow: 'hidden' }}><div className="card-h"><div className="h3">2 · The lines as filed</div><span className="t12 c3 mono">{filed ? `filed ${fmtDate(filed.at)} · ${filed.hash.slice(0, 12)}` : 'not filed yet: showing the current return'}</span></div>
              <table className="tbl"><thead><tr><th style={{ width: 170 }}>Line</th><th>Description</th><th className="r" style={{ width: 160 }}>As filed</th><th className="r" style={{ width: 160 }}>Engine</th></tr></thead>
                <tbody>{keys.map((k) => { const l = lineOf(k); return <tr key={k} className="click" onClick={() => navigate('return', { line: k })}><td className="mono t12">{k}</td><td>{l?.label}</td><td className="r num w6">{lineValue(filedLines.get(k) ?? state.return.lines.find((x) => x.key === k)?.effective ?? l?.value, k)}</td><td className="r num c3">{lineValue(l?.value, k)}</td></tr>; })}</tbody></table>
            </div>
          )}

          {docs.length > 0 && (
            <div className="card mb16"><div className="card-h"><div className="h3">3 · Source documents</div><span className="t12 c3">{docs.length}</span></div>
              <div>{docs.map((d) => <div key={d} className="lrow click" onClick={() => openTrace({ ref: d })}><span className="filetile">{d}</span><span className="grow">{packet.index.documents.get(d)?.title}</span><span className="t12 c3">{packet.index.documents.get(d)?.issuer}</span></div>)}</div></div>
          )}

          {keys.length > 0 && (
            <div className="card mb16" style={{ overflow: 'hidden' }}><div className="card-h"><div className="h3">4 · The firm's review of these lines</div><span className="t12 c3">{items.length} findings · {events.length} recorded actions</span></div>
              {items.length === 0 ? <div className="card-b c3">No findings touched these lines.</div> : (
                <table className="tbl"><thead><tr><th>Finding</th><th style={{ width: 220 }}>Decision</th><th style={{ width: 260 }}>Sign-offs</th></tr></thead>
                  <tbody>{items.map((i) => (
                    <tr key={i.id} className="click" onClick={() => navigate('finding', { id: i.id })}>
                      <td><div className="w5">{i.title}</div><div className="t12 c3">{i.message?.slice(0, 140)}</div></td>
                      <td>{i.closing ? <div><div className="t13">{ACTION_WORDS[i.closing.kind]}</div><div className="t12 c3">{actorById.get(i.closing.actor)?.name} · {fmtDate(i.closing.at)}</div></div> : <span className="pill amber">Not decided</span>}</td>
                      <td>{i.signoffs.length ? i.signoffs.map((s) => <div key={s.id} className="t12">{s.payload.level}: {actorById.get(s.actor)?.name} · {fmtDate(s.at)}</div>) : <span className="t12 c4">None</span>}</td>
                    </tr>))}</tbody></table>
              )}
            </div>
          )}

          <div className="card mb24"><div className="card-h"><div className="h3">{keys.length ? '5' : '2'} · Response</div>{resp && <span className="pill green">Recorded {fmtDateTime(resp.at)}</span>}</div>
            <div className="card-b">
              {resp ? <><p className="t13" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{resp.payload.text}</p><div className="t12 c3 mt12">By {actorById.get(resp.actor)?.name} · tied to filed return {resp.filedHash.slice(0, 16)}…</div></> : (
                <div className="col gap12">
                  <textarea className="textarea" style={{ minHeight: 120 }} value={text || defaultText} onChange={(e) => setText(e.target.value)} />
                  <div className="between"><span className="t12 c3">{state.filed ? 'Recording ties the response to the filed return\'s content hash.' : 'A response can be recorded once the return is filed.'}</span>
                    <button type="button" className="btn primary" disabled={!state.filed || !['preparer', 'reviewer', 'partner'].includes(actor?.role)} onClick={() => dispatch({ kind: 'notice_response', target: n.id, payload: { text: text || defaultText, lines: keys, documents: docs, findings: items.map((i) => i.id) } }, { label: 'Notice response recorded' })}><Mail size={15} /> Record response</button></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Client's copy ───────────────────────────────────────────────────────────

export function ClientCopy() {
  const { state } = useWorkpaper();
  const f = state.filings.filter((x) => !x.rejected).at(-1);
  const ret = f?.return ?? state.return;
  const hh = raw.household;
  const key = [['F1040.9', 'Total income'], ['F1040.11', 'Adjusted gross income'], ['F1040.15', 'Taxable income'], ['F1040.24', 'Total tax'], ['F1040.33', 'Total payments']];
  const eff = new Map(ret.lines.map((l) => [l.key, l.effective]));
  return (
    <>
      <Header><Crumbs items={[['Filing', ['filing']], ["Client's copy"]]} /></Header>
      <div className="content">
        <div className="page copy-page">
          <div className="between mb24 no-print">
            <div className="t13 c3">{f ? `The return as ${f.type === 'amended' ? 'amended' : 'filed'} on ${fmtDate(f.at)}` : 'Draft: the return has not been filed yet'}</div>
            <button type="button" className="btn" onClick={() => window.print()}><Printer size={15} /> Print or save as PDF</button>
          </div>
          <div className="copy">
            <div className="between"><div><div className="cap">{raw.firm.name}</div><h1 className="h1 mt8">2025 Income Tax Returns</h1><div className="sub">{hh.people.filter((p) => p.relationship !== 'dependent' && p.role !== 'dependent').slice(0, 2).map((p) => p.name ?? `${p.first_name} ${p.last_name}`).join(' and ')} · Married filing jointly</div></div>
              <div className="r">{f ? <span className="pill green">{f.type === 'amended' ? 'Amended' : 'Filed'} {fmtDate(f.at)}</span> : <span className="pill amber">Draft</span>}<div className="t12 c3 mono mt8">{(f?.hash ?? '').slice(0, 16)}</div></div></div>
            <div className="copy-figs">
              <div><span className="cap">Federal (Form 1040)</span><b>{owe(ret.effective.federal.balance_due)}</b></div>
              <div><span className="cap">California (540NR)</span><b>{owe(ret.effective.california.balance_due)}</b></div>
            </div>
            <table className="tbl mt16"><tbody>{key.map(([k, l]) => <tr key={k}><td>{l}</td><td className="r num w6">{money(eff.get(k) ?? lineOf(k)?.value)}</td></tr>)}</tbody></table>
            <div className="t13 c2 mt24">Keep this copy with your records for at least seven years. Your 2026 estimated tax plan and carryovers are on the next page.</div>
            {f?.acks?.length > 0 && <div className="t12 c3 mt12">{f.acks.map((a) => `${JUR[a.payload.jurisdiction]} ${a.payload.status} ${fmtDate(a.at)}`).join(' · ')}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
