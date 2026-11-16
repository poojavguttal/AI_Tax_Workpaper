// Compare engine versions (v1 → v2 → v3) and replay the season's timeline.

import { useMemo, useState } from 'react';
import { ArrowRight, Plus, Minus, GitCompare, Play, FileText } from 'lucide-react';
import { packet, matched, actorById } from '../state/base.js';
import { runChecks } from '../../domain/checks/index.js';
import { money, money2, signed, fmtDate, fmtDateTime, KIND } from '../format.js';
import { Crumbs } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';

const VERSIONS = packet.raw.return_versions;
const checksBy = Object.fromEntries(VERSIONS.map((v) => [v.version, runChecks(packet, matched, { version: v.version })]));
const linesBy = Object.fromEntries(VERSIONS.map((v) => [v.version, new Map(packet.lines.filter((l) => l.version === v.version).map((l) => [l.key, l]))]));
const FIGS = [['federal', 'agi', 'Federal AGI'], ['federal', 'taxable_income', 'Taxable income'], ['federal', 'total_tax', 'Federal total tax'], ['federal', 'payments', 'Federal payments'], ['federal', 'balance_due', 'Federal balance due'], ['california', 'ca_agi', 'California AGI'], ['california', 'total_tax', 'California total tax'], ['california', 'balance_due', 'California balance due']];
const REVIEW = ['error', 'conflict', 'judgment'];
const docTitle = (id) => packet.index.documents.get(id)?.title ?? id;

function diffLines(a, b) {
  const A = linesBy[a]; const B = linesBy[b];
  const out = [];
  for (const [k, l] of B) {
    const o = A.get(k);
    if (!o) out.push({ key: k, kind: 'added', line: l, from: null, to: l.value });
    else if (JSON.stringify(o.value) !== JSON.stringify(l.value)) out.push({ key: k, kind: 'changed', line: l, from: o.value, to: l.value });
  }
  for (const [k, l] of A) if (!B.has(k)) out.push({ key: k, kind: 'removed', line: l, from: l.value, to: null });
  return out;
}

export function Versions({ params }) {
  const [from, setFrom] = useState(params.from ?? 'v2');
  const [to, setTo] = useState(params.to ?? 'v3');
  const [showAll, setShowAll] = useState(false);
  const A = VERSIONS.find((v) => v.version === from); const B = VERSIONS.find((v) => v.version === to);
  const lines = useMemo(() => diffLines(from, to), [from, to]);
  const forms = new Map();
  for (const d of lines) { const f = d.line.form; if (!forms.has(f)) forms.set(f, []); forms.get(f).push(d); }
  const idsA = new Map(checksBy[from].results.map((r) => [r.id, r])); const idsB = new Map(checksBy[to].results.map((r) => [r.id, r]));
  const appeared = [...idsB.values()].filter((r) => !idsA.has(r.id));
  const cleared = [...idsA.values()].filter((r) => !idsB.has(r.id));
  const newDocs = B.documents_used.filter((d) => !A.documents_used.includes(d));
  const goneDocs = A.documents_used.filter((d) => !B.documents_used.includes(d));
  const shownForms = showAll ? [...forms] : [...forms].slice(0, 6);
  const fmtV = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? money(v) : money2(v)) : v ?? '—');

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Versions']]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <h1 className="h1">Versions</h1>
              <div className="sub">The engine ran three times this season. Compare any two runs line by line, see which findings each one raised or cleared, and replay the season as it happened.</div>
            </div>
          </div>

          <div className="ver-row mb24">
            {VERSIONS.map((v, i) => {
              const c = checksBy[v.version].results;
              return (
                <div key={v.version} className={`ver ${v.version === from ? 'from' : ''} ${v.version === to ? 'to' : ''}`}>
                  <div className="between"><span className="ver-tag">{v.version}</span><span className="t12 c3">{fmtDateTime(v.computed_at)}</span></div>
                  <div className="t13 c2 mt8 clamp2" title={v.trigger}>{v.trigger}</div>
                  <div className="ver-figs">
                    <div><span className="cap">Federal</span><b>{v.summary.federal.balance_due < 0 ? `${money(-v.summary.federal.balance_due)} refund` : `${money(v.summary.federal.balance_due)} owed`}</b></div>
                    <div><span className="cap">California</span><b>{v.summary.california.balance_due < 0 ? `${money(-v.summary.california.balance_due)} refund` : `${money(v.summary.california.balance_due)} owed`}</b></div>
                  </div>
                  <div className="row t12 c3 mt8" style={{ gap: 12 }}><span><FileText size={12} /> {v.documents_used.length} documents</span><span>{c.filter((r) => REVIEW.includes(r.kind)).length} findings · {c.length} checks raised</span></div>
                  <div className="row mt12" style={{ gap: 6 }}>
                    <button type="button" className={`btn sm ${v.version === from ? 'primary' : ''}`} onClick={() => setFrom(v.version)} disabled={v.version === to}>Compare from</button>
                    <button type="button" className={`btn sm ${v.version === to ? 'primary' : ''}`} onClick={() => setTo(v.version)} disabled={v.version === from}>to</button>
                  </div>
                  {i < VERSIONS.length - 1 && <ArrowRight className="ver-arrow" size={18} />}
                </div>
              );
            })}
          </div>

          <div className="grid-main mb24">
            <div className="tf sheet-form">
              <div className="tf-head">
                <div className="tf-code"><span>Compare</span>{from}→{to}</div>
                <div className="tf-title"><div className="w6">{to} compared with {from}</div><div className="t12 c3">{B.trigger}</div></div>
                <div className="tf-year">2025</div>
              </div>
              <table className="tf-tbl">
                <colgroup><col /><col style={{ width: 150 }} /><col style={{ width: 150 }} /><col style={{ width: 130 }} /></colgroup>
                <thead><tr><th style={{ textAlign: 'left', paddingLeft: 14 }}>Figure</th><th>{from}</th><th>{to}</th><th>Change</th></tr></thead>
                <tbody>
                  {FIGS.map(([j, k, l]) => {
                    const a = A.summary[j][k]; const b = B.summary[j][k];
                    return (
                      <tr key={l} className={k === 'balance_due' ? 'last' : ''}>
                        <td><div className="tf-label"><span>{l}</span><i /></div></td>
                        <td className="tf-amt c3">{money(a)}</td><td className="tf-amt adj">{money(b)}</td>
                        <td className={`tf-amt ${b - a ? 'w6' : 'c4'}`}>{signed(b - a)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="col gap16">
              <div className="card">
                <div className="card-h"><div className="h3">Documents</div><span className="t12 c3">{A.documents_used.length} → {B.documents_used.length}</span></div>
                <div style={{ padding: '6px 0' }}>
                  {newDocs.length === 0 && goneDocs.length === 0 && <div className="t13 c3" style={{ padding: '10px 20px' }}>Same documents.</div>}
                  {newDocs.map((d) => <div key={d} className="lrow click" style={{ padding: '10px 20px' }} onClick={() => navigate('document', { id: d })}><Plus size={14} className="green" /><span className="mono t12 c3">{d}</span><span className="t13 ellipsis grow">{docTitle(d)}</span></div>)}
                  {goneDocs.map((d) => <div key={d} className="lrow click" style={{ padding: '10px 20px' }} onClick={() => navigate('document', { id: d })}><Minus size={14} className="red" /><span className="mono t12 c3">{d}</span><span className="t13 ellipsis grow">{docTitle(d)}</span></div>)}
                  {B.documents_superseded?.length > 0 && <div className="t12 c3" style={{ padding: '8px 20px' }}>Superseded in {to}: {B.documents_superseded.join(', ')}</div>}
                </div>
              </div>
              <div className="card">
                <div className="card-h"><div className="h3">Findings</div><span className="t12 c3">{appeared.length} raised · {cleared.length} cleared</span></div>
                <div style={{ padding: '6px 0' }}>
                  {cleared.map((r) => <div key={r.id} className="lrow" style={{ padding: '10px 20px' }}><span className="pill green">Cleared</span><span className="t13 ellipsis grow" title={r.title}>{r.title}</span></div>)}
                  {appeared.map((r) => <div key={r.id} className="lrow click" style={{ padding: '10px 20px' }} onClick={() => to === 'v3' && navigate('finding', { id: r.id })}><span className="pill amber">New</span><span className="t13 ellipsis grow" title={r.title}>{r.title}</span></div>)}
                  {appeared.length + cleared.length === 0 && <div className="t13 c3" style={{ padding: '10px 20px' }}>The same checks fire on both runs.</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="tf sheet-form mb24">
            <div className="tf-head">
              <div className="tf-code"><span>Lines</span>{lines.length}</div>
              <div className="tf-title"><div className="w6">Every line that changed</div><div className="t12 c3">{forms.size} forms · added, removed or changed between {from} and {to}</div></div>
              <div className="tf-year"><GitCompare size={22} /></div>
            </div>
            <table className="tf-tbl sch-tbl">
              <colgroup><col style={{ width: 150 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 150 }} /><col style={{ width: 130 }} /></colgroup>
              <thead><tr><th style={{ textAlign: 'left', paddingLeft: 14 }}>Line</th><th style={{ textAlign: 'left', paddingLeft: 14 }}>Description</th><th>{from}</th><th>{to}</th><th>Change</th></tr></thead>
              <tbody>
                {shownForms.flatMap(([f, ds]) => [
                  <tr key={f} className="tf-part"><td colSpan={5}>{f} · {ds.length} {ds.length === 1 ? 'line' : 'lines'}</td></tr>,
                  ...ds.slice(0, showAll ? 500 : 12).map((d) => (
                    <tr key={d.key} className={to === 'v3' && d.kind !== 'removed' ? 'click' : ''} onClick={() => to === 'v3' && d.kind !== 'removed' && navigate('return', { line: d.key })}>
                      <td style={{ paddingLeft: 14 }} className="mono t12">{d.key}</td>
                      <td><div className="sch-label ellipsis" title={d.line.label}>{d.line.label}</div></td>
                      <td className="tf-amt c3">{d.kind === 'added' ? <span className="pill green">Added</span> : fmtV(d.from)}</td>
                      <td className="tf-amt adj">{d.kind === 'removed' ? <span className="pill red">Removed</span> : fmtV(d.to)}</td>
                      <td className="tf-amt">{typeof d.from === 'number' && typeof d.to === 'number' ? signed(Math.round(d.to - d.from)) : '—'}</td>
                    </tr>
                  )),
                  ...(!showAll && ds.length > 12 ? [<tr key={`${f}-more`}><td colSpan={5} className="t12 c3" style={{ paddingLeft: 14 }}>+{ds.length - 12} more in {f}</td></tr>] : []),
                ])}
              </tbody>
            </table>
            {(forms.size > 6 || [...forms.values()].some((d) => d.length > 12)) && <div style={{ padding: 12, textAlign: 'center', borderTop: '1px solid var(--border)' }}><button type="button" className="btn sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : `Show all ${lines.length} lines`}</button></div>}
          </div>

          <Replay />
        </div>
      </div>
    </>
  );
}

// ── Season replay ───────────────────────────────────────────────────────────

const EVENT_WORDS = {
  engagement_signed: 'Engagement letter signed', questionnaire_submitted: 'Client questionnaire submitted', client_marked_upload_complete: 'Client marked upload complete',
  return_computed: 'Engine computed the return', work_started: 'Preparation started', irs_transcript_pulled: 'IRS transcript pulled', document_received: 'Document received',
  staff_joined_engagement: 'Staff joined the engagement', client_call: 'Client call', extension_filed_with_payment: 'Extension filed with payment', client_message: 'Client message',
  client_approved_and_signed_8879: 'Client approved and signed Form 8879', efile_rejected: 'E-file rejected', efile_accepted_federal: 'Federal e-file accepted', efile_accepted_california: 'California e-file accepted',
  federal_balance_paid: 'Federal balance paid', california_refund_issued: 'California refund issued', quality_review_selected_return: 'Selected for quality review',
  next_year_engagement_started: '2026 engagement started', notice_received: 'IRS notice received',
};

function Replay() {
  const tl = packet.raw.timeline;
  const [i, setI] = useState(tl.findIndex((t) => t.event === 'return_computed' && t.at.startsWith('2026-06')) );
  const at = tl[i].at;
  const version = [...VERSIONS].reverse().find((v) => v.computed_at <= at);
  const docsBy = packet.documents.filter((d) => (d.received_at ?? '') <= at).length;
  const refs = (t) => (t.refs ?? []).filter((r) => packet.index.documents.get(r));
  const c = version ? checksBy[version.version].results.filter((r) => REVIEW.includes(r.kind)) : [];
  return (
    <div className="card">
      <div className="card-h">
        <div className="row" style={{ gap: 12 }}><span className="ico"><Play size={16} /></span><div><div className="h3">Season replay</div><div className="t12 c3">Drag through the season: what the firm knew and what the return said at each moment</div></div></div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          <button type="button" className="btn sm" disabled={i === tl.length - 1} onClick={() => setI(i + 1)}>Next</button>
        </div>
      </div>
      <div style={{ padding: '18px 24px 8px' }}>
        <input type="range" min={0} max={tl.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} className="replay-range" />
        <div className="replay-ticks">{tl.map((t, k) => <span key={t.id} className={`${k <= i ? 'on' : ''} ${t.event === 'return_computed' ? 'big' : ''}`} style={{ left: `${(k / (tl.length - 1)) * 100}%` }} title={`${fmtDate(t.at)} · ${EVENT_WORDS[t.event] ?? t.event}`} />)}</div>
      </div>
      <div className="replay-body">
        <div>
          <div className="cap">{fmtDateTime(at)}</div>
          <div className="h3 mt8">{EVENT_WORDS[tl[i].event] ?? tl[i].event}</div>
          {tl[i].actor && <div className="t13 c2 mt4">{actorById.get(tl[i].actor)?.name}</div>}
          {tl[i].detail && <div className="t13 c2 mt8">{tl[i].detail}</div>}
          {refs(tl[i]).length > 0 && <div className="row mt12" style={{ gap: 6, flexWrap: 'wrap' }}>{refs(tl[i]).map((r) => <button type="button" key={r} className="pill outline" style={{ cursor: 'pointer' }} onClick={() => navigate('document', { id: r })}>{r} · {docTitle(r).slice(0, 48)}</button>)}</div>}
        </div>
        <div className="replay-figs">
          <div><span className="cap">Documents in</span><b>{docsBy}</b></div>
          <div><span className="cap">Engine</span><b>{version?.version ?? 'Not run'}</b></div>
          <div><span className="cap">Federal</span><b>{version ? (version.summary.federal.balance_due < 0 ? `${money(-version.summary.federal.balance_due)} refund` : `${money(version.summary.federal.balance_due)} owed`) : '—'}</b></div>
          <div><span className="cap">California</span><b>{version ? (version.summary.california.balance_due < 0 ? `${money(-version.summary.california.balance_due)} refund` : `${money(version.summary.california.balance_due)} owed`) : '—'}</b></div>
          <div><span className="cap">Findings</span><b>{version ? c.length : '—'}</b></div>
        </div>
      </div>
      <div className="replay-list">
        {tl.map((t, k) => (
          <button type="button" key={t.id} className={`replay-item ${k === i ? 'on' : ''} ${k > i ? 'future' : ''}`} onClick={() => setI(k)}>
            <span className="t12 c3 num" style={{ width: 96, flex: 'none' }}>{fmtDate(t.at)}</span>
            <span className="t13 ellipsis">{EVENT_WORDS[t.event] ?? t.event}</span>
          </button>
        ))}
      </div>
      <div className="t12 c3" style={{ padding: '10px 24px 16px' }}>Findings by kind in {version?.version ?? '—'}: {REVIEW.map((k) => `${c.filter((r) => r.kind === k).length} ${KIND[k].label.toLowerCase()}`).join(' · ')}</div>
    </div>
  );
}
