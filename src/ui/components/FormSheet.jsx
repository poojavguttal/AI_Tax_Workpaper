// Draws one page of a source document the way the paper looks: a form header band,
// payer and recipient blocks, numbered boxes, line-item tables for lots/trips/payments,
// and the text as printed. Every extracted value is a target that tracing can focus.
//
// Renderers are picked by pages.render_kind. 'simulated' builds the form from the
// packet; 'image'/'pdf' would draw the scan from pages.asset_url with each value's
// position box on top. Tracing only addresses (doc_id, page, observation id), so a
// real scan replaces the simulation without changing anything else.

import { useEffect, useRef } from 'react';
import { packet, matched, checks } from '../state/base.js';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { amount2, usDate, maskSsn } from '../format.js';

const FORMS = {
  'W-2': ['W-2', 'Wage and Tax Statement', 'Employer', 'Employee'],
  '1099-NEC': ['1099-NEC', 'Nonemployee Compensation', 'Payer', 'Recipient'],
  '1099-INT': ['1099-INT', 'Interest Income', 'Payer', 'Recipient'],
  '1099-K': ['1099-K', 'Payment Card and Third Party Network Transactions', 'Filer', 'Payee'],
  '1099-composite': ['1099', 'Consolidated Form 1099 · Div, Int, B', 'Payer', 'Recipient'],
  '1099-R': ['1099-R', 'Distributions From Pensions, Annuities, IRAs', 'Payer', 'Recipient'],
  '1099-SA': ['1099-SA', 'Distributions From an HSA', 'Trustee', 'Recipient'],
  '1099-S': ['1099-S', 'Proceeds From Real Estate Transactions', 'Filer', 'Transferor'],
  '1099-DA': ['1099-DA', 'Digital Asset Proceeds From Broker Transactions', 'Broker', 'Customer'],
  1098: ['1098', 'Mortgage Interest Statement', 'Recipient / lender', 'Payer / borrower'],
  '1098-T': ['1098-T', 'Tuition Statement', 'Filer', 'Student'],
  '1098-C': ['1098-C', 'Contributions of Motor Vehicles, Boats, and Airplanes', 'Donee', 'Donor'],
  5498: ['5498', 'IRA Contribution Information', 'Trustee', 'Participant'],
  '5498-SA': ['5498-SA', 'HSA Contribution Information', 'Trustee', 'Participant'],
  3921: ['3921', 'Exercise of an Incentive Stock Option', 'Transferor', 'Employee'],
  3922: ['3922', 'Transfer of Stock Acquired Through an ESPP', 'Transferor', 'Employee'],
  'K-1-1065': ['K-1', 'Partner\'s Share of Income · Form 1065', 'Partnership', 'Partner'],
  'K-1-1120S': ['K-1', 'Shareholder\'s Share of Income · Form 1120-S', 'Corporation', 'Shareholder'],
  prior_year_return: ['1040', 'U.S. Individual Income Tax Return (as filed)', 'Preparer', 'Taxpayers'],
};

const RECORD = /^([A-Za-z]+-?\d+)_(.+)$/;
const flagged = new Set(checks.results.filter((r) => ['error', 'conflict'].includes(r.kind)).flatMap((r) => r.evidence));
const humanize = (s) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function owner(doc) {
  const people = packet.raw.household.people;
  const b = doc.belongs_to;
  if (b === 'taxpayer') return people.find((p) => p.role === 'taxpayer')?.name;
  if (b === 'spouse') return people.find((p) => p.role === 'spouse')?.name;
  if (b === 'joint') return `${people[0].name} & ${people[1].name}`;
  if (b?.startsWith('dependent:')) return people.find((p) => p.id === b.slice(10))?.name;
  return b;
}

function display(o, canSee) {
  const v = o.value;
  if (v === null || v === undefined || v === '') return '';
  if (o.value_type === 'ssn') return canSee ? v : maskSsn(v);
  if (o.value_type === 'account_number') return canSee ? v : `•••• ${String(v).slice(-4)}`;
  if (o.field === 'ip_pin') return canSee ? v : '••••••';
  if (o.value_type === 'money') return amount2(v);
  if (o.value_type === 'date') return usDate(v);
  if (o.value_type === 'boolean') return v ? '☒' : '☐';
  if (o.value_type === 'percent' || (typeof v === 'number' && v > 0 && v < 1)) return `${Math.round(v * 1000) / 10}%`;
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return String(v);
}

/** The printed text, with each extracted value underlined where it appears. */
function Printed({ text, observations, focus, onSelect, canSee }) {
  const spans = [];
  for (const o of observations) {
    const needle = o.text_as_read;
    if (!needle || needle.length < 2) continue;
    let from = 0;
    while (from < text.length) {
      const i = text.indexOf(needle, from);
      if (i < 0) break;
      const j = i + needle.length;
      const clean = !/[\d.,]/.test(text[i - 1] ?? ' ') && !/\d/.test(text[j] ?? ' ');
      if (clean && !spans.some((s) => i < s.end && j > s.start)) { spans.push({ start: i, end: j, o }); break; }
      from = i + 1;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const mask = (s) => (canSee ? s : s.replace(/\b\d{3}-\d{2}-\d{4}\b/g, maskSsn).replace(/\bSE\d{2}(?: \d{4}){5}\b/g, (m) => `SE•• •••• ${m.slice(-4)}`));
  const out = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) out.push(mask(text.slice(at, s.start)));
    out.push(<mark key={s.o.id} className={s.o.id === focus ? 'focus' : ''} title={`${s.o.label} · ${s.o.id}`} onClick={() => onSelect(s.o.id)}>{mask(text.slice(s.start, s.end))}</mark>);
    at = s.end;
  }
  if (at < text.length) out.push(mask(text.slice(at)));
  return <>{out}</>;
}

export function FormSheet({ docId, pageNo, focus, onSelect, zoom = 1 }) {
  const { state, actorId } = useWorkpaper();
  // Cleared staff still see masked values until they reveal them; the reveal is a logged event.
  const canSeeSensitive = state.viewLog?.some((v) => v.actor === actorId && v.payload.field === `doc:${docId}`);
  const ref = useRef(null);
  const doc = packet.index.documents.get(docId);
  const page = packet.index.pages.get(`${docId}#${pageNo}`);
  const observations = packet.observations.filter((o) => o.doc_id === docId && o.page === pageNo);
  useEffect(() => {
    if (focus) ref.current?.querySelector(`[data-obs="${focus}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, docId, pageNo]);
  if (!doc || !page) return null;

  const form = FORMS[doc.document_type];
  const boxes = [];
  const records = new Map();
  const columns = [];
  for (const o of observations) {
    const m = RECORD.exec(o.field ?? '');
    if (m && !/^box/i.test(m[1])) {
      if (!records.has(m[1])) records.set(m[1], new Map());
      records.get(m[1]).set(m[2], o);
      if (!columns.includes(m[2])) columns.push(m[2]);
    } else boxes.push(o);
  }
  const rel = matched.relations;
  const watermark = rel.some((r) => r.kind === 'supersedes' && r.of === docId) ? 'SUPERSEDED'
    : rel.some((r) => r.kind === 'duplicate_document' && r.doc === docId) ? 'DUPLICATE COPY'
      : rel.find((r) => r.kind === 'duplicate_page' && r.doc === docId && r.page === pageNo) ? `RESCAN OF PAGE ${rel.find((r) => r.kind === 'duplicate_page' && r.doc === docId && r.page === pageNo).of_page}` : null;
  const cls = (o) => `${o.id === focus ? 'focus' : ''} ${flagged.has(o.id) || o.confidence < 0.6 ? 'warn' : ''}`;

  return (
    <div className="sheet" ref={ref} style={{ zoom }}>
      {doc.marked_corrected && <div className="corrected">CORRECTED</div>}
      {watermark && <div className="watermark">{watermark}</div>}

      <div className="f-head">
        <div className="l">
          {form ? (
            <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
              <span className="t12" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', lineHeight: 1 }}>Form</span>
              <span className="code">{form[0]}</span>
              <span className="ttl" style={{ paddingBottom: 4 }}>{form[1]}</span>
            </div>
          ) : (
            <div><div style={{ fontSize: 18, fontWeight: 700 }}>{doc.issuer}</div><div className="ttl" style={{ fontWeight: 500, color: '#3f3f46' }}>{doc.title}</div></div>
          )}
        </div>
        <div className="yr"><span className="t12">{form ? 'Tax year' : 'Year'}</span><b>{doc.tax_year}</b></div>
      </div>

      {form && (
        <div className="f-party">
          <div><div className="t12" style={{ color: '#3f3f46' }}>{form[2]}</div><div className="w6 mt8">{doc.issuer}</div></div>
          <div><div className="t12" style={{ color: '#3f3f46' }}>{form[3]}</div><div className="w6 mt8">{owner(doc)}</div></div>
        </div>
      )}

      {boxes.length > 0 && (
        <div className="f-grid" style={form ? undefined : { borderTop: '1.5px solid #111', marginTop: 18 }}>
          {boxes.map((o) => (
            <div key={o.id} data-obs={o.id} className={`f-box ${cls(o)}`} onClick={() => onSelect(o.id)} title={`${o.id} · confidence ${o.confidence}`}>
              <span className="bl">{o.label}</span>
              <span className="bv">{display(o, canSeeSensitive) || <span style={{ color: '#a1a1aa' }}>blank</span>}</span>
            </div>
          ))}
          {Array.from({ length: (3 - (boxes.length % 3)) % 3 }, (_, i) => <div key={`pad${i}`} className="f-box" style={{ cursor: 'default' }} />)}
        </div>
      )}

      {records.size > 0 && (
        <>
          <div className="f-sec">Detail · {records.size} {records.size === 1 ? 'item' : 'items'}</div>
          <table className="f-table">
            <thead><tr><th>Item</th>{columns.map((c) => <th key={c} style={{ textAlign: /proceeds|basis|amount|wash|miles|ordinary|cost/.test(c) ? 'right' : 'left' }}>{humanize(c)}</th>)}</tr></thead>
            <tbody>
              {[...records].map(([name, cells]) => (
                <tr key={name}>
                  <td style={{ fontFamily: 'var(--font)', color: '#111', fontWeight: 600 }}>{name}</td>
                  {columns.map((c) => {
                    const o = cells.get(c);
                    if (!o) return <td key={c} />;
                    return (
                      <td key={c} data-obs={o.id} className={`f-cell ${cls(o)}`} onClick={() => onSelect(o.id)}
                        style={{ textAlign: o.value_type === 'money' || /miles/.test(c) ? 'right' : 'left' }}>
                        {display(o, canSeeSensitive) || <span style={{ color: '#a1a1aa' }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="f-sec">{observations.length ? 'Text on this page' : 'Page content'}</div>
      <div className="f-printed"><Printed text={page.printed_content} observations={observations} focus={focus} onSelect={onSelect} canSee={canSeeSensitive} /></div>

      <div className="f-foot"><span>{doc.file_name}</span><span>Page {pageNo} of {doc.page_count}</span></div>
    </div>
  );
}
