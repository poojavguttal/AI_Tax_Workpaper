// The client portal and the examiner's read-only view.

import { useState } from 'react';
import { CheckCircle2, Circle, PenLine, Printer, MessageCircleQuestion, FileText, Search, Eye, Landmark } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { packet, actorById, line as lineOf, linesOf, resultsByLine } from '../state/base.js';
import { money, fmtDate, fmtDateTime, lineValue, ACTION_WORDS } from '../format.js';
import { Crumbs, Household, Person } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { LineTrace } from '../components/Trace.jsx';
import { QuestionThread, AskForm } from '../components/People.jsx';
import { NOTICE_LINES } from './Filing.jsx';
import { navigate } from '../state/router.js';

const raw = packet.raw;
const owe = (n) => (n < 0 ? { label: 'Refund', v: money(-n), tone: 'green' } : { label: 'You owe', v: money(n), tone: '' });

// ── Client portal ───────────────────────────────────────────────────────────

export function ClientPortal() {
  const { state, dispatch, actor } = useWorkpaper();
  const isClient = actor?.kind === 'client';
  const me = isClient ? actor : actorById.get('cu-01');
  const partnerSigned = state.returnSignoffs.some((s) => s.valid && s.payload.level === 'partner');
  const approved = state.approvals.find((a) => a.valid);
  const filed = state.filings.filter((f) => !f.rejected).at(-1);
  const ret = filed?.return ?? state.return;
  const forClient = state.questions.filter((q) => actorById.get(q.payload.to)?.kind === 'client');
  const fromClient = state.questions.filter((q) => actorById.get(q.actor)?.kind === 'client');
  const [pin, setPin] = useState('');
  const [agree, setAgree] = useState(false);
  const fed = owe(ret.effective.federal.balance_due); const ca = owe(ret.effective.california.balance_due);
  const uploaded = packet.documents.filter((d) => d.uploaded_by === 'client');
  const corrections = state.items.filter((i) => i.closing && ['correct', 'decide'].includes(i.closing.kind)).length;
  const steps = [
    ['We received your documents', true],
    ['Your preparer is reviewing', state.items.some((i) => i.closing)],
    ['Partner approved the return', partnerSigned],
    ['You approve and sign', Boolean(approved)],
    ['Filed with the IRS and California', Boolean(filed)],
    ['Accepted', Boolean(filed?.acks.some((a) => a.payload.status === 'accepted'))],
  ];
  const accepted = filed?.acks.filter((a) => a.payload.status === 'accepted').map((a) => a.payload.jurisdiction) ?? [];

  return (
    <>
      <Header><Crumbs items={[['Your 2025 tax return']]} /></Header>
      <div className="content portal">
        <div className="page" style={{ maxWidth: 1080 }}>
          {!isClient && <div className="callout mb16 t13">You are seeing the client portal as Ngozi and Erik see it. Switch to a client in the menu at the bottom left to answer or approve as them.</div>}
          <div className="portal-hero mb24">
            <Household size={56} />
            <div className="grow">
              <div className="t13 c3">{raw.firm.name}</div>
              <h1 className="h1">Hi {me.name.split(' ')[0]}, here is your 2025 return</h1>
              <div className="sub">Married filing jointly · Federal Form 1040 and California 540NR (part-year, moved to Texas Jul 15)</div>
            </div>
          </div>

          <div className="portal-steps mb24">
            {steps.map(([l, done], k) => <div key={l} className={`ps ${done ? 'done' : ''} ${!done && steps.slice(0, k).every((s) => s[1]) ? 'now' : ''}`}>{done ? <CheckCircle2 size={18} /> : <Circle size={18} />}<span>{l}</span></div>)}
          </div>

          <div className="grid-2 mb24">
            <div className={`portal-fig ${fed.tone}`}><span className="cap">Federal · {fed.label}</span><b>{fed.v}</b><span className="t12 c3">{filed ? (accepted.includes('federal') ? 'Accepted by the IRS' : 'Sent to the IRS') : partnerSigned ? 'Ready for your approval' : 'Draft · still in review'}</span></div>
            <div className={`portal-fig ${ca.tone}`}><span className="cap">California · {ca.label}</span><b>{ca.v}</b><span className="t12 c3">{filed ? (accepted.includes('california') ? 'Accepted by the FTB' : 'Sent to the FTB') : partnerSigned ? 'Ready for your approval' : 'Draft · still in review'}</span></div>
          </div>

          <div className="grid-main">
            <div className="col gap16">
              <div className="card">
                <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><MessageCircleQuestion size={16} /></span><div className="h3">Questions from your preparer</div></div><span className="t12 c3">{forClient.filter((q) => !q.answer).length} waiting</span></div>
                <div style={{ padding: '4px 24px 16px' }}>{forClient.length === 0 ? <div className="c3" style={{ padding: '14px 0' }}>No questions right now.</div> : forClient.slice().reverse().map((q) => <QuestionThread key={q.id} q={q} compact />)}</div>
              </div>
              <div className="card">
                <div className="card-h"><div className="h3">Ask your preparer</div></div>
                <div className="card-b">{isClient ? <AskForm target="return" defaultTo="st-01" /> : <div className="t13 c3">Switch to a client to ask.</div>}
                  {fromClient.length > 0 && <div className="mt16">{fromClient.slice().reverse().map((q) => <QuestionThread key={q.id} q={q} compact />)}</div>}</div>
              </div>
            </div>
            <div className="col gap16">
              <div className="card">
                <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><PenLine size={16} /></span><div className="h3">Approve and sign</div></div></div>
                <div className="card-b col gap12">
                  {approved ? <div className="row" style={{ gap: 8 }}><CheckCircle2 size={18} className="green" /><span>Approved by {actorById.get(approved.actor)?.name} on {fmtDate(approved.at)}</span></div>
                    : !partnerSigned ? <div className="t13 c2">Your preparer is still finishing the review ({state.blockers.length} items left). We will let you know when it is ready to sign.</div>
                      : (
                        <>
                          <div className="t13 c2">By signing Forms 8879 and FTB 8879 you authorise {raw.firm.name} to file this return electronically with the amounts shown. {corrections > 0 ? `${corrections} items were corrected or decided during review.` : ''}</div>
                          <input className="input" placeholder="Your 5-digit signature PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 5))} />
                          <label className="row t13" style={{ gap: 8 }}><input type="checkbox" className="check" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have reviewed the return and it is true, correct and complete.</label>
                          <button type="button" className="btn primary" disabled={!isClient || pin.length !== 5 || !agree} onClick={() => dispatch({ kind: 'client_approval', target: 'return', payload: { form: '8879', pin_on_file: true } }, { label: 'Thank you. Your return is approved and signed.' })}>Approve and sign</button>
                        </>
                      )}
                  {approved && !approved.valid && <div className="t12 red">The return changed after you approved it. Please approve again.</div>}
                </div>
              </div>
              {filed && (
                <div className="card"><div className="card-h"><div className="h3">Your copy</div></div>
                  <div className="card-b col gap8"><button type="button" className="btn" onClick={() => navigate('copy')}><Printer size={15} /> View and print your return</button><div className="t12 c3">Filed {fmtDate(filed.at)}. Keep it for seven years.</div></div></div>
              )}
              <div className="card"><div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><FileText size={16} /></span><div className="h3">Documents you sent</div></div><span className="t12 c3">{uploaded.length}</span></div>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>{uploaded.slice(0, 40).map((d) => <div key={d.id} className="lrow" style={{ padding: '9px 20px' }}><span className="t13 grow ellipsis">{d.title}</span><span className="t12 c4">{fmtDate(d.received_at)}</span></div>)}</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Examiner view ───────────────────────────────────────────────────────────

const START = ['F1040.9', 'F1040.11', 'F1040.15', 'F1040.24', 'F1040.33', 'F1040.37'];

export function Examiner({ params }) {
  const { state, openTrace } = useWorkpaper();
  const [q, setQ] = useState('');
  const filed = state.filings.filter((f) => !f.rejected).at(-1);
  const filedLines = new Map((filed?.return.lines ?? state.return.lines).map((l) => [l.key, l.effective]));
  const sel = params.line ?? 'SchA.12';
  const notice = Object.values(NOTICE_LINES).flat();
  const s = q.trim().toLowerCase();
  const list = s ? linesOf().filter((l) => `${l.key} ${l.label}`.toLowerCase().includes(s)).slice(0, 40) : [...new Set([...notice, ...START])].map((k) => lineOf(k)).filter(Boolean);
  const items = (resultsByLine.get(sel) ?? []).map((id) => state.itemsById.get(id)).filter(Boolean);
  const val = (k) => filedLines.get(k) ?? lineOf(k)?.value;
  return (
    <>
      <Header><Crumbs items={[['Examiner view'], [sel]]} /></Header>
      <div className="exam-banner"><Eye size={15} /> Read-only examiner view · {filed ? `return as filed ${fmtDate(filed.at)} · content hash ${filed.hash.slice(0, 16)}` : 'return not filed yet: showing the current return'} · nothing here can change the record</div>
      <div className="with-panel" style={{ flex: 1 }}>
        <div style={{ overflowY: 'auto' }}>
          <div className="page" style={{ maxWidth: 'none' }}>
            <div className="page-head"><div><h1 className="h1">Why is this number here?</h1><div className="sub">Pick any line to see how it was built, the source documents, and every decision and sign-off behind it.</div></div></div>
            <div className="search mb16" style={{ maxWidth: 520 }}><Search size={16} /><input className="input" placeholder="Find a line, e.g. gross receipts, 8283, SchC.1" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {!s && <div className="cap mb8">Lines in the open examination, then the main totals</div>}
            <div className="card mb24" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <tbody>{list.map((l) => (
                  <tr key={l.key} className={`click ${sel === l.key ? 'sel' : ''}`} onClick={() => navigate('examiner', { line: l.key })}>
                    <td className="mono t12" style={{ width: 170 }}>{l.key}</td>
                    <td style={{ maxWidth: 1 }}><div className="row" style={{ gap: 8, minWidth: 0 }}><span className="ellipsis">{l.label}</span>{notice.includes(l.key) && <span className="pill amber" style={{ flex: 'none' }}><Landmark size={11} /> Under exam</span>}</div></td>
                    <td className="r num w6" style={{ width: 150 }}>{lineValue(val(l.key), l.key)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="card">
              <div className="card-h"><div className="h3">Decisions and sign-offs on {sel}</div><span className="t12 c3">{items.length}</span></div>
              {items.length === 0 ? <div className="card-b t13 c3">No findings were raised on this line; it is as the engine computed it from the cited sources.</div> : items.map((i) => (
                <div key={i.id} className="lrow" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="w5">{i.title}</div>
                    <div className="t12 c3 mt4">{i.closing ? `${ACTION_WORDS[i.closing.kind]} by ${actorById.get(i.closing.actor)?.name} on ${fmtDate(i.closing.at)}${i.closing.payload.rationale ? `: ${i.closing.payload.rationale}` : ''}${i.closing.payload.authority ? ` (${i.closing.payload.authority})` : ''}` : 'No decision recorded'}</div>
                    {i.signoffs.map((so) => <div key={so.id} className="t12 mt4"><CheckCircle2 size={12} className="green" /> {so.payload.level} sign-off · {actorById.get(so.actor)?.name} · {fmtDateTime(so.at)}</div>)}
                  </div>
                  <span className={`pill ${i.status === 'closed' ? 'green' : 'amber'}`}>{i.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><span className="h3">How {sel} was built</span></div>
          <div className="panel-b"><LineTrace key={sel} lineKey={sel} readOnly onOpenRef={(ref) => (packet.index.lines.get(`v3|${ref}`) ? navigate('examiner', { line: ref }) : openTrace({ ref }))} /></div>
        </div>
      </div>
    </>
  );
}
