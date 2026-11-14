// Tracing in both directions.
//  LineTrace:  a return line -> how it was built -> the facts and every source behind them.
//  DocViewer:  a document, PDF-style -> its fields -> every line it reached (or why none).
//  TraceDrawer: the side sheet any reference opens.

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Minus, Plus, ArrowUpRight, ShieldCheck, ExternalLink, Eye, EyeOff } from 'lucide-react';
import {
  packet, matched, factOfObs, consumersOf, resultsByLine, line as lineOf, landingsOfDoc, relationsOfDoc,
  dispositionOfDoc, docStatus, activities, resolveRef, parseRef, checks, VERSION,
} from '../state/base.js';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { lineValue, fmtDate, money, plain } from '../format.js';
import { Kind, Status, Person, KV } from './ui.jsx';
import { FormSheet } from './FormSheet.jsx';
import { navigate } from '../state/router.js';

const FACT_STATUS = { single: ['One source', 'gray'], corroborated: ['Corroborated', 'green'], conflict: ['Sources disagree', 'red'], incomplete: ['Value missing', 'amber'] };
const ROLE = { primary: 'Primary', duplicate: 'Duplicate', included_in: 'Already included', superseded: 'Superseded', supporting: 'Supporting', part: 'Part', component: 'Component' };

export function sourceName(o) {
  if (!o) return '';
  if (o.source_kind === 'doc_value') return `${o.doc_id} · p.${o.page}`;
  if (o.id.startsWith('household:')) return 'Organizer';
  if (o.id.startsWith('qa-')) return 'Questionnaire';
  if (o.id.startsWith('msg-')) return 'Client message';
  if (o.id.startsWith('call-')) return 'Call notes';
  if (o.source_kind === 'agency') return 'Agency record';
  return 'Prior year';
}

export function showValue(v, type) {
  if (Array.isArray(v)) return `${v.length} notes`;
  if (typeof v === 'number') {
    if (type === 'money' || (type === undefined && Math.abs(v) >= 100)) return money(v);
    if (Math.abs(v) < 1 && !Number.isInteger(v)) return `${Math.round(v * 1000) / 10}%`;
    return plain(v);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v && typeof v === 'object') return '—';
  return v ?? '—';
}

function FindingRows({ ids }) {
  const { state, closeTrace } = useWorkpaper();
  const items = (ids ?? []).map((id) => state.itemsById.get(id)).filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="card mt16">
      {items.map((it, i) => (
        <div key={it.id} className="between" style={{ padding: '10px 12px', borderTop: i ? '1px solid var(--border)' : 0, cursor: 'pointer' }}
          onClick={() => { closeTrace(); navigate('finding', { id: it.id }); }}>
          <div className="row grow" style={{ gap: 12 }}><Kind kind={it.kind} /><span className="ellipsis w5">{it.title}</span></div>
          <div className="row"><Status status={it.status} /><ArrowUpRight size={14} className="c4" /></div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, aside, children }) {
  return (
    <section className="mt24">
      <div className="between mb8"><div className="h3">{title}</div>{aside}</div>
      {children}
    </section>
  );
}

export function LineTrace({ lineKey, onOpenRef }) {
  const { state, dispatch } = useWorkpaper();
  const types = packet.raw.firm.starter_standards.verification_types;
  const [vtype, setVtype] = useState(types[0]);
  const l = lineOf(lineKey);
  if (!l) return <div className="c3">No line {lineKey} in {VERSION}.</div>;
  const eff = state.return.lines.find((x) => x.key === lineKey);
  const facts = [];
  const other = [];
  for (const s of l.sources) {
    const fm = factOfObs.get(s);
    if (fm) { if (!facts.includes(fm.fact)) facts.push(fm.fact); } else other.push(s);
  }
  const cites = new Set(l.sources);
  const verified = state.verifications[`line:${lineKey}`] ?? [];
  return (
    <div>
      <div className="cap">{l.jurisdiction === 'federal' ? 'Federal' : 'California'} · {l.form} · line {l.line}</div>
      <div className="h2 mt8">{l.label}</div>
      <div className="mt16">
        <KV cols={3} items={[
          ['Engine v3', <span className={`num ${eff ? 'strike' : ''}`}>{lineValue(l.value, l.key)}</span>],
          ['Adjusted', eff ? <span className="num green">{lineValue(eff.effective, l.key)}</span> : <span className="c4">No change</span>],
          ['Rule', <span className="mono">{l.rule}</span>],
        ]} />
      </div>
      {l.note && <div className="callout mt16 c2">{l.note}</div>}
      <FindingRows ids={resultsByLine.get(lineKey)} />

      {l.inputs.length > 0 && (
        <Section title="Built from">
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <tbody>
                {l.inputs.map((k) => {
                  const i = lineOf(k);
                  return (
                    <tr key={k} className="click" onClick={() => onOpenRef(k)}>
                      <td style={{ width: 120 }}><span className="mono c2">{k}</span></td>
                      <td className="ellipsis" style={{ maxWidth: 1 }}>{i?.label}</td>
                      <td className="r num w5">{lineValue(i?.value, k)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Evidence" aside={<span className="t12 c3">Each fact, with every source that reports it</span>}>
        {facts.length === 0 && other.length === 0 && <div className="c3">Computed from the lines above.</div>}
        {facts.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl" style={{ tableLayout: 'fixed' }}>
              <thead><tr><th>Field and source</th><th className="r" style={{ width: 132 }}>Value</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {facts.flatMap((f) => {
                  const [label, tone] = FACT_STATUS[f.status] ?? FACT_STATUS.single;
                  return [
                    <tr key={f.id} className="group">
                      <td colSpan={3} style={{ background: 'var(--subtle)' }}>
                        <div className="between"><span className="ellipsis" title={f.label}>{f.label}</span><span className={`pill ${tone}`}>{label}</span></div>
                      </td>
                    </tr>,
                    ...f.members.map((m) => {
                      const o = packet.index.observations.get(m.obs);
                      return (
                        <tr key={m.obs} className="click" onClick={() => onOpenRef(m.obs)}>
                          <td style={{ maxWidth: 1, paddingTop: 8, paddingBottom: 8 }}>
                            <div className="ellipsis" title={o?.label}>{o?.label}</div>
                            <div className="t12 c3 ellipsis">{sourceName(o)} · {ROLE[m.role]}{cites.has(m.obs) ? ' · cited by this line' : ''} · <span className="mono">{m.obs}</span></div>
                          </td>
                          <td className={`r num w5 ${m.role === 'superseded' ? 'strike' : ''}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(showValue(m.value, o?.value_type))}>{showValue(m.value, o?.value_type)}</td>
                          <td><ExternalLink size={13} className="c4" /></td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {other.length > 0 && (
          <div className="card mt12" style={{ overflow: 'hidden' }}>
            <table className="tbl"><tbody>
              {other.map((s) => {
                const p = parseRef(s);
                const r = resolveRef(packet, s, { version: VERSION });
                const v = typeof r?.target === 'object' ? (r.target?.value ?? r.target?.amount ?? '') : r?.target;
                return (
                  <tr key={s} className="click" onClick={() => onOpenRef(s)}>
                    <td style={{ width: 150 }}><span className="w5">{p.kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</span></td>
                    <td className="ellipsis" style={{ maxWidth: 1 }}><span className="mono c2">{s}</span></td>
                    <td className="r num w5">{showValue(v)}</td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
        )}
      </Section>

      {(consumersOf.get(lineKey) ?? []).length > 0 && (
        <Section title="Flows into">
          <div className="row wrap">{consumersOf.get(lineKey).map((c) => <button type="button" key={c.key} className="ref" onClick={() => onOpenRef(c.key)}>{c.key}</button>)}</div>
        </Section>
      )}

      <Section title="Verification">
        {verified.map((v) => (
          <div key={v.id} className="row mb8"><ShieldCheck size={15} className="green" /><Person id={v.actor} /><span className="c3">{v.payload.type.replace(/_/g, ' ')} · {fmtDate(v.at)}</span></div>
        ))}
        <div className="row">
          <select className="select" style={{ width: 260 }} value={vtype} onChange={(e) => setVtype(e.target.value)}>
            {types.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</option>)}
          </select>
          <button type="button" className="btn" onClick={() => dispatch({ kind: 'verify', target: `line:${lineKey}`, payload: { type: vtype, evidence: l.sources } }, { label: `${lineKey} verified` })}>Record verification</button>
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function SensitiveToggle({ docId }) {
  const { state, actorId, canSeeSensitive, dispatch } = useWorkpaper();
  const shown = state.viewLog?.some((v) => v.actor === actorId && v.payload.field === `doc:${docId}`);
  if (shown) return <span className="t12 c3 row" style={{ gap: 6 }}><Eye size={14} /> Sensitive values shown · view logged</span>;
  return (
    <button type="button" className="btn sm ghost" disabled={!canSeeSensitive} title={canSeeSensitive ? 'Reveal SSNs and account numbers (logged)' : 'You do not have sensitive-data clearance'}
      onClick={() => dispatch({ kind: 'view_sensitive', target: `doc:${docId}`, payload: { field: `doc:${docId}` } }, { label: 'Unmasked view logged', undoable: false })}>
      <EyeOff size={14} /> {canSeeSensitive ? 'Reveal sensitive values' : 'Masked · no clearance'}
    </button>
  );
}

export function DocViewer({ docId, pageNo, focusObs, onOpenRef, compact = false }) {
  const doc = packet.index.documents.get(docId);
  const [page, setPage] = useState(pageNo ?? packet.index.observations.get(focusObs)?.page ?? 1);
  const [focus, setFocus] = useState(focusObs);
  const [zoom, setZoom] = useState(compact ? 0.9 : 1);
  const [tab, setTab] = useState('fields');
  const { state } = useWorkpaper();
  if (!doc) return null;
  const st = docStatus(doc);
  const obs = packet.observations.filter((o) => o.doc_id === docId && o.page === page);
  const landings = landingsOfDoc(docId);
  const rels = relationsOfDoc(docId);
  const disp = dispositionOfDoc(docId);
  const findings = checks.results.filter((r) => ['error', 'conflict', 'judgment', 'completeness'].includes(r.kind)
    && r.evidence.some((e) => e === docId || e.startsWith(`doc:${docId}#`) || packet.index.observations.get(e)?.doc_id === docId)).map((r) => r.id);
  const pagesWithValues = new Set(packet.observations.filter((o) => o.doc_id === docId).map((o) => o.page));
  const select = (id) => { setFocus(id); setTab('fields'); };
  const relText = (r) => {
    const other = r.doc === docId ? r.of : r.doc;
    const t = {
      duplicate_document: r.doc === docId ? 'Re-upload of' : 'Re-uploaded as',
      supersedes: r.doc === docId ? `Corrects (${r.changed?.length ?? 0} values changed)` : 'Superseded by',
      same_fact: 'Same item as', components: r.doc === docId ? 'Installments make up' : 'Made up of installments on',
      included_in: r.doc === docId ? 'Already included in' : 'Includes amounts from',
    }[r.kind];
    return r.kind === 'duplicate_page' ? { text: `Page ${r.page} is a second scan of page ${r.of_page}` } : { text: t, other };
  };
  const statusTone = { used: 'green', unaccounted: 'red', duplicate: 'amber', partial: 'amber', superseded: 'gray', not_extracted: 'gray' }[st.key];

  return (
    <div className="viewer" style={compact ? { gridTemplateColumns: '96px minmax(0, 1fr) 320px' } : undefined}>
      <div className="thumbs">
        {Array.from({ length: doc.page_count }, (_, i) => i + 1).map((p) => (
          <div key={p} style={{ paddingBottom: 18 }}>
            <div className={`thumb ${p === page ? 'on' : ''} ${pagesWithValues.has(p) ? 'hasv' : ''}`} onClick={() => setPage(p)} title={`Page ${p}`}>
              <i style={{ width: '60%', height: 5, background: '#d4d4d8' }} />
              {Array.from({ length: 9 }, (_, k) => <i key={k} style={{ width: `${55 + ((k * 37 + p * 13) % 40)}%` }} />)}
              <span className="pn">{p}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="canvas">
        <div className="toolbar">
          <button type="button" className="btn sm icon ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
          <span className="t12 c2 num" style={{ minWidth: 70, textAlign: 'center' }}>{page} / {doc.page_count}</span>
          <button type="button" className="btn sm icon ghost" disabled={page >= doc.page_count} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
          <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 8px' }} />
          <button type="button" className="btn sm icon ghost" onClick={() => setZoom(Math.max(0.6, zoom - 0.1))} aria-label="Zoom out"><Minus size={15} /></button>
          <span className="t12 c2 num" style={{ minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn sm icon ghost" onClick={() => setZoom(Math.min(1.6, zoom + 0.1))} aria-label="Zoom in"><Plus size={15} /></button>
          <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 8px' }} />
          <SensitiveToggle docId={docId} />
        </div>
        <div className="sheet-wrap"><FormSheet docId={docId} pageNo={page} focus={focus} onSelect={select} zoom={zoom} /></div>
      </div>

      <div style={{ borderLeft: '1px solid var(--border)' }}>
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <div className="between"><span className="mono c3">{doc.id}</span><span className={`pill ${statusTone}`}>{st.label}</span></div>
          <div className="h3 mt8">{doc.title}</div>
          <div className="t12 c3 mt8">{activities.get(matched.docActivity.get(docId))?.name}</div>
          <div className="mt16"><KV cols={2} items={[['Received', fmtDate(doc.received_at)], ['Uploaded by', doc.uploaded_by], ['Belongs to', doc.belongs_to], ['Extraction', doc.extraction_status]]} /></div>
          {(rels.length > 0 || disp) && (
            <div className="mt16 col gap4">
              {rels.map((r, i) => { const t = relText(r); return <div key={i} className="row t12">{t.text}{t.other && <button type="button" className="ref" onClick={() => onOpenRef(t.other)}>{t.other}</button>}</div>; })}
              {disp && <div className="t12 c3">{disp.reason}</div>}
            </div>
          )}
        </div>
        <div className="tabs" style={{ padding: '0 8px' }}>
          {[['fields', 'Fields', obs.length], ['landed', 'Landed on', landings.length], ['findings', 'Findings', findings.length]].map(([k, l, n]) => (
            <button type="button" key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}<span className="n">{n}</span></button>
          ))}
        </div>
        {tab === 'fields' && (
          <div>
            {obs.length === 0 && <div className="empty t12">Nothing on this page was extracted.</div>}
            {obs.map((o) => (
              <div key={o.id} onClick={() => setFocus(o.id)} className="between" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: o.id === focus ? 'var(--selected)' : undefined }}>
                <div className="grow"><div className="ellipsis">{o.label}</div><div className="mono c4">{o.id}{o.confidence < 0.9 ? ` · ${o.confidence}` : ''}</div></div>
                <span className={`num w5 ${o.confidence < 0.6 ? 'red' : ''}`}>{o.value_type === 'ssn' ? `•••-••-${String(o.value).slice(-4)}` : showValue(o.value, o.value_type)}</span>
              </div>
            ))}
          </div>
        )}
        {tab === 'landed' && (
          <div>
            {landings.length === 0 && <div className="empty t12">{disp ? 'Accounted for by its disposition.' : 'No value from this document reaches the return.'}</div>}
            {landings.map(({ line: l }) => {
              const eff = state.return.lines.find((x) => x.key === l.key);
              return (
                <div key={l.key} onClick={() => onOpenRef(l.key)} className="between" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                  <div className="grow"><div className="ellipsis">{l.label}</div><div className="mono c4">{l.key}</div></div>
                  <span className="num w5">{eff ? lineValue(eff.effective, l.key) : lineValue(l.value, l.key)}</span>
                </div>
              );
            })}
          </div>
        )}
        {tab === 'findings' && (
          <div style={{ padding: '0 16px 16px' }}>
            {findings.length === 0 ? <div className="empty t12">No findings rely on this document.</div> : <FindingRows ids={findings} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Record({ refId }) {
  const r = resolveRef(packet, refId, { version: VERSION });
  const p = parseRef(refId);
  const t = r?.target;
  return (
    <div style={{ maxWidth: 680 }}>
      <div className="row"><span className="pill gray">{p.kind.replace(/_/g, ' ')}</span><span className="mono c3">{refId}</span></div>
      {p.kind === 'questionnaire' && <><div className="label mt16">Question</div><div className="h2 mt8">{t.question}</div><div className="callout mt16 t14">“{t.answer}”</div><div className="t12 c3 mt8">{t.answered_by} · {fmtDate(t.answered_at)}</div></>}
      {p.kind === 'message' && <><div className="label mt16">Message from {t.from}</div><div className="callout mt8 t14">“{t.text}”</div><div className="t12 c3 mt8">{fmtDate(t.sent_at)}</div></>}
      {p.kind === 'call_note' && <><div className="label mt16">Call · {fmtDate(t.date)} · {t.participants.join(', ')}</div><ul className="t14" style={{ paddingLeft: 18, lineHeight: '24px' }}>{t.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></>}
      {!['questionnaire', 'message', 'call_note'].includes(p.kind) && (
        <pre className="mono mt16" style={{ whiteSpace: 'pre-wrap', background: 'var(--subtle)', padding: 16, borderRadius: 8, border: '1px solid var(--border)', margin: '16px 0 0' }}>{JSON.stringify(t ?? null, null, 2)}</pre>
      )}
    </div>
  );
}

export function TraceDrawer() {
  const { trace, closeTrace } = useWorkpaper();
  const [stack, setStack] = useState([]);
  if (!trace) return null;
  const current = stack.at(-1) ?? trace.ref;
  const open = (ref) => setStack((s) => [...s, ref]);
  const p = parseRef(current);
  const obs = packet.index.observations.get(current);
  const isDoc = obs?.doc_id || p.kind === 'document' || p.kind === 'page';
  const close = () => { setStack([]); closeTrace(); };
  let body;
  if (p.kind === 'line') body = <div style={{ padding: 24 }}><LineTrace lineKey={current} onOpenRef={open} /></div>;
  else if (isDoc) body = <DocViewer key={current} compact docId={obs?.doc_id ?? p.docId ?? current} pageNo={p.page ?? obs?.page} focusObs={obs?.id} onOpenRef={open} />;
  else body = <div style={{ padding: 24 }}><Record refId={current} /></div>;
  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="sheet-panel" role="dialog">
        <div className="panel-h" style={{ position: 'static' }}>
          <div className="row grow">
            {stack.length > 0 && <button type="button" className="btn sm ghost" onClick={() => setStack((s) => s.slice(0, -1))}><ChevronLeft size={14} /> Back</button>}
            <span className="mono c3 ellipsis">{[trace.ref, ...stack].join('  ›  ')}</span>
          </div>
          <div className="row">
            {p.kind === 'line' && <button type="button" className="btn sm" onClick={() => { close(); navigate('return', { line: current }); }}>Open in return</button>}
            {isDoc && <button type="button" className="btn sm" onClick={() => { close(); navigate('document', { id: obs?.doc_id ?? p.docId ?? current, obs: obs?.id }); }}>Open document</button>}
            <button type="button" className="btn sm icon ghost" onClick={close} aria-label="Close"><X size={16} /></button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: isDoc ? 'hidden' : 'auto' }}>{body}</div>
      </aside>
    </>
  );
}
