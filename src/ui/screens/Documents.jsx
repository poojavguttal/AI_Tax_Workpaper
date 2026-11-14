import { useMemo, useState } from 'react';
import { Search, Minus, Plus, CheckCircle2, AlertTriangle, Copy, FileWarning } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { packet, docStatus, activities, matched, landingsOfDoc } from '../state/base.js';
import { fmtDate } from '../format.js';
import { Crumbs, Empty, Stat } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { DocViewer } from '../components/Trace.jsx';
import { navigate } from '../state/router.js';

const TONE = { used: 'green', unaccounted: 'red', duplicate: 'amber', partial: 'amber', superseded: 'gray', not_extracted: 'gray' };
const FILTERS = [['all', 'All'], ['used', 'On return'], ['unaccounted', 'Needs disposition'], ['duplicate', 'Duplicate'], ['superseded', 'Superseded'], ['partial', 'Page unread'], ['not_extracted', 'Not extracted']];

const CODE = {
  'W-2': 'W-2', '1099-NEC': '1099', '1099-INT': '1099', '1099-K': '1099', '1099-composite': '1099', '1099-R': '1099', '1099-SA': '1099', '1099-S': '1099', '1099-DA': '1099',
  1098: '1098', '1098-T': '1098', '1098-C': '1098', 5498: '5498', '5498-SA': '5498', 3921: '3921', 3922: '3922', 'K-1-1065': 'K-1', 'K-1-1120S': 'K-1', 'K-1-state-supplement': 'K-1', prior_year_return: '1040', paystub: 'PAY',
};
const TYPE_NAME = (t) => ({ '1099-composite': 'Consolidated 1099', prior_year_return: 'Prior-year return', 'K-1-state-supplement': 'K-1 state supplement',
  irs_ip_pin_notice: 'IRS IP PIN notice', consent_7216: 'Section 7216 consent', irs_notice: 'IRS notice', irs_transcript: 'IRS transcript', 'K-1-1065': 'Schedule K-1 (1065)', 'K-1-1120S': 'Schedule K-1 (1120-S)' }[t]
  ?? t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
const DOT = { green: 'var(--green)', red: 'var(--red)', amber: '#f59e0b', gray: 'var(--gray-dot)' };

export function Documents() {
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const [closed, setClosed] = useState(new Set());
  const docs = useMemo(() => packet.documents.map((d) => ({
    ...d, st: docStatus(d), actId: matched.docActivity.get(d.id), landed: landingsOfDoc(d.id).length,
  })), []);
  const counts = docs.reduce((m, d) => ({ ...m, [d.st.key]: (m[d.st.key] ?? 0) + 1 }), {});
  const shown = docs.filter((d) => (f === 'all' || d.st.key === f) && (!q || `${d.id} ${d.title} ${d.issuer} ${d.document_type}`.toLowerCase().includes(q.toLowerCase())));
  const groups = new Map();
  for (const d of shown) { if (!groups.has(d.actId)) groups.set(d.actId, []); groups.get(d.actId).push(d); }
  const toggle = (k) => setClosed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Documents']]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <h1 className="h1">Documents</h1>
              <div className="sub">{packet.documents.length} documents across {new Set(docs.map((d) => d.actId)).size} activities. Each one reaches the return, is a duplicate or superseded copy, or needs a recorded disposition.</div>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <div className="search" style={{ width: 280 }}><Search size={16} /><input className="input" placeholder="Search issuer, form or id" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <button type="button" className="btn" onClick={() => setClosed(closed.size ? new Set() : new Set(groups.keys()))}>{closed.size ? 'Expand all' : 'Collapse all'}</button>
            </div>
          </div>
          <div className="stats mb24">
            <Stat label="On the return" value={counts.used ?? 0} sub="Values reach at least one line" icon={CheckCircle2} tone="green" onClick={() => setF('used')} />
            <Stat label="Needs disposition" value={counts.unaccounted ?? 0} sub="Explain before filing" icon={AlertTriangle} tone={counts.unaccounted ? 'amber' : ''} onClick={() => setF('unaccounted')} />
            <Stat label="Duplicate or superseded" value={(counts.duplicate ?? 0) + (counts.superseded ?? 0)} sub="Kept, not counted twice" icon={Copy} />
            <Stat label="Pages unread" value={counts.partial ?? 0} sub="A page was never extracted" icon={FileWarning} tone={counts.partial ? 'red' : ''} onClick={() => setF('partial')} />
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-h" style={{ flexWrap: 'wrap' }}>
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {FILTERS.map(([k, l]) => <button type="button" key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}<span className="n">{k === 'all' ? docs.length : counts[k] ?? 0}</span></button>)}
              </div>
            </div>
            {shown.length === 0 ? <Empty title="No documents match" /> : (
              <table className="tbl roomy" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th style={{ width: 170 }}>Form</th>
                    <th style={{ width: 130 }}>Received</th>
                    <th className="r" style={{ width: 80 }}>Pages</th>
                    <th className="r" style={{ width: 110 }}>Landed on</th>
                    <th style={{ width: 210 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...groups].flatMap(([act, list]) => {
                    const isOpen = !closed.has(act) || Boolean(q);
                    const attention = list.filter((d) => d.st.key === 'unaccounted').length;
                    return [
                      <tr key={act} className="section click" onClick={() => toggle(act)}>
                        <td colSpan={6}>
                          <div className="row" style={{ gap: 10 }}>
                            <span className="tree-btn">{isOpen ? <Minus size={11} /> : <Plus size={11} />}</span>
                            <span className="w6">{activities.get(act)?.name ?? act}</span>
                            <span className="t12 c3">{list.length} {list.length === 1 ? 'document' : 'documents'}</span>
                            {attention > 0 && <span className="t12 red row" style={{ gap: 6 }}><span className="dot" style={{ background: 'var(--red)' }} />{attention} {attention === 1 ? 'needs' : 'need'} disposition</span>}
                          </div>
                        </td>
                      </tr>,
                      ...(isOpen ? list.map((d) => {
                        const tone = TONE[d.st.key];
                        return (
                          <tr key={d.id} className="click" onClick={() => navigate('document', { id: d.id })}>
                            <td style={{ paddingLeft: 44 }}>
                              <div className="row" style={{ gap: 14 }}>
                                <span className={`filetile ${CODE[d.document_type] ? 'form' : ''}`}>{CODE[d.document_type] ?? 'PDF'}</span>
                                <div className="grow">
                                  <div className="w5 ellipsis" title={d.title}>{d.title}</div>
                                  <div className="t12 c3 ellipsis" style={{ marginTop: 2 }}>{d.issuer} · <span className="mono">{d.id}</span></div>
                                </div>
                              </div>
                            </td>
                            <td className="c2 ellipsis">{TYPE_NAME(d.document_type)}</td>
                            <td className="num c2">{fmtDate(d.received_at)}</td>
                            <td className="r num c2">{d.page_count}</td>
                            <td className="r num">{d.landed ? <span className="w5">{d.landed} {d.landed === 1 ? 'line' : 'lines'}</span> : <span className="c4">—</span>}</td>
                            <td>
                              <div className="row" style={{ gap: 6 }}>
                                <span className={`pill ${tone}`}><span className="dot" style={{ background: DOT[tone] }} />{d.st.label}</span>
                                {d.marked_corrected && <span className="pill outline">Corrected</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      }) : []),
                    ];
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function Document({ params }) {
  const { openTrace } = useWorkpaper();
  const doc = packet.index.documents.get(params.id);
  if (!doc) return <><Header><Crumbs items={[['Documents', ['documents']], ['Not found']]} /></Header><Empty title="No such document" /></>;
  return (
    <>
      <Header><Crumbs items={[['Documents', ['documents']], [`${doc.id} · ${doc.title}`]]} /></Header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DocViewer key={`${doc.id}-${params.obs ?? ''}-${params.page ?? ''}`} docId={doc.id} pageNo={params.page ? Number(params.page) : undefined} focusObs={params.obs}
          onOpenRef={(ref) => (packet.index.documents.get(ref) ? navigate('document', { id: ref }) : openTrace({ ref }))} />
      </div>
    </>
  );
}
