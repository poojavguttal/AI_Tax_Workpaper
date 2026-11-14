import { useMemo, useState } from 'react';
import { Search, X, ListChecks } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { ROLE_LABEL, KIND } from '../format.js';
import { Status, Signed, Avatar, Crumbs, Empty, fedOf, caOf, payOf } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';

export const TABS = [
  ['findings', 'All findings', ['error', 'conflict', 'judgment', 'adjustment']],
  ['error', 'Errors', ['error']],
  ['conflict', 'Conflicts', ['conflict']],
  ['judgment', 'Judgments', ['judgment']],
  ['completeness', 'To account for', ['completeness']],
  ['outside_filing', 'Outside filings', ['outside_filing']],
];
const ORDER = ['error', 'conflict', 'judgment', 'adjustment', 'completeness', 'outside_filing'];
const size = (i) => Math.max(...['federal', 'california', 'federal_payments', 'california_payments'].map((k) => Math.abs(i.effect?.[k] ?? 0)));

export function needsMe(item, actor) {
  if (!actor || actor.kind !== 'staff' || item.status === 'closed') return false;
  const valid = new Set(item.signoffs.filter((s) => !item.stale.includes(s.id)).map((s) => s.payload.level));
  if (actor.role === 'preparer') return !item.closing || item.status === 'reopened';
  if (actor.role === 'reviewer') return Boolean(item.closing) && item.closing.actor !== actor.id && !valid.has('reviewer');
  if (actor.role === 'partner') return Boolean(item.closing) && item.requiredSignoffs.includes('partner') && !valid.has('partner') && item.closing.actor !== actor.id;
  return false;
}

function Effect({ e }) {
  const parts = [['Federal', fedOf(e), false], ['California', caOf(e), false], ['Payments', payOf(e), true]].filter(([, v]) => v);
  if (!parts.length) return <span className="c4">No tax effect</span>;
  return (
    <div className="col" style={{ gap: 2 }}>
      {parts.slice(0, 2).map(([k, v, p]) => <div key={k} className="between t12" style={{ maxWidth: 128 }}><span className="c3">{k}</span><span className="w6"><Signed value={v} payments={p} /></span></div>)}
    </div>
  );
}

export function Queue({ params }) {
  const { state, actor, dispatch } = useWorkpaper();
  const tab = TABS.some(([k]) => k === params.kind) ? params.kind : 'findings';
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set());
  const [open, setOpen] = useState(new Set());
  const kinds = TABS.find(([k]) => k === tab)[2];
  const items = useMemo(() => state.items
    .filter((i) => kinds.includes(i.kind))
    .filter((i) => (status === 'active' ? i.status !== 'closed' : status === 'mine' ? needsMe(i, actor) : status === 'all' || i.status === status))
    .filter((i) => !q || `${i.title} ${i.id} ${i.lines.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || size(b) - size(a)), [state.items, kinds, status, q, actor]);
  const counts = Object.fromEntries(TABS.map(([k, , ks]) => [k, state.items.filter((i) => ks.includes(i.kind) && i.status !== 'closed').length]));
  const chosen = items.filter((i) => sel.has(i.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = items.length > 0 && items.every((i) => sel.has(i.id));
  const level = actor?.role === 'partner' ? 'partner' : 'reviewer';
  const bulk = {
    accept: chosen.filter((i) => ['conflict', 'judgment'].includes(i.kind) && !i.closing && Number.isInteger(i.recommendation?.alternative)),
    correct: chosen.filter((i) => i.kind === 'error' && !i.closing),
    explain: chosen.filter((i) => ['completeness', 'outside_filing'].includes(i.kind) && !i.closing),
    sign: chosen.filter((i) => i.closing && i.status !== 'closed' && i.requiredSignoffs.includes(level)),
  };
  const run = async (what) => {
    let drafts = [];
    if (what === 'accept') drafts = bulk.accept.map((i) => ({ kind: 'decide', target: i.id, payload: { alternative: i.recommendation.alternative, rationale: i.recommendation.rationale ?? i.recommendation.treatment, ...(i.recommendation.authority ? { authority: i.recommendation.authority } : {}) } }));
    if (what === 'correct') drafts = bulk.correct.map((i) => ({ kind: 'correct', target: i.id, payload: { reason: i.title } }));
    if (what === 'explain') {
      const text = window.prompt(`One explanation for ${bulk.explain.length} item(s)`);
      if (!text) return;
      drafts = bulk.explain.map((i) => ({ kind: { explanation: 'explain', acknowledgement: 'acknowledge' }[i.requires.action] ?? 'dispose', target: i.id, payload: { reason: text, explanation: text, note: text } }));
    }
    if (what === 'sign') drafts = bulk.sign.map((i) => ({ kind: 'signoff', target: i.id, payload: { level } }));
    if (!drafts.length) return;
    await dispatch(drafts, { label: `${drafts.length} items updated` });
    setSel(new Set());
  };

  const STATUSES = [['active', 'Not closed'], ['open', 'Open'], ['awaiting_signoff', 'Awaiting sign-off'], ['reopened', 'Reopened'], ['closed', 'Closed'], ['all', 'All']];
  const tabLabel = TABS.find(([k]) => k === tab)[1];

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Review']]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <h1 className="h1">Review</h1>
              <div className="sub">Every finding stays open until someone records a correction or decision and the required reviewers sign off.</div>
            </div>
            <label className={`toggle ${status === 'mine' ? 'on' : ''}`}>
              <input type="checkbox" hidden checked={status === 'mine'} onChange={() => { setStatus(status === 'mine' ? 'active' : 'mine'); setSel(new Set()); }} />
              <i />Only items waiting on me <span className="c4">({ROLE_LABEL[actor?.role] ?? '—'})</span>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
            <div className="rail" style={{ position: 'sticky', top: 0 }}>
              {TABS.map(([k, label]) => (
                <button type="button" key={k} className={`rail-btn ${tab === k ? 'on' : ''}`} onClick={() => { navigate('queue', { kind: k }); setSel(new Set()); }}>
                  {k !== 'findings' ? <span className="dot" style={{ background: KIND[k].color }} /> : <ListChecks size={16} />}
                  <span className="grow">{label}</span><span className="count">{counts[k]}</span>
                </button>
              ))}
              <div className="t12 c4" style={{ padding: '12px 4px' }}>Counts are items not yet closed.</div>
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-h" style={{ flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 12 }}><span className="h2">{tabLabel}</span><span className="count">{items.length}</span></div>
                <div className="row" style={{ gap: 12 }}>
                  <div className="search" style={{ width: 280 }}><Search size={16} /><input className="input" placeholder="Search by title, line or id" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                  <select className="select" style={{ width: 180 }} value={status === 'mine' ? 'active' : status} disabled={status === 'mine'} onChange={(e) => { setStatus(e.target.value); setSel(new Set()); }}>
                    {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
              </div>
              {items.length === 0 ? <Empty title="Nothing to show">{status === 'mine' ? 'Nothing here is waiting on you.' : 'No items match these filters.'}</Empty> : (
                <table className="tbl tall" style={{ tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 52 }}><input type="checkbox" className="check" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(items.map((i) => i.id)))} aria-label="Select all" /></th>
                      <th style={{ width: '27%' }}>Finding</th>
                      <th>Reason</th>
                      <th style={{ width: 152 }}>Estimated effect</th>
                      <th style={{ width: 150 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const valid = i.signoffs.filter((s) => !i.stale.includes(s.id));
                      return (
                        <tr key={i.id} className={`click ${sel.has(i.id) ? 'sel' : ''}`} onClick={() => navigate('finding', { id: i.id })}>
                          <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="check" checked={sel.has(i.id)} onChange={() => toggle(i.id)} aria-label="Select" /></td>
                          <td style={{ verticalAlign: 'top', paddingTop: 16 }}>
                            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                              <span className="dot" style={{ background: KIND[i.kind].color, marginTop: 7 }} title={KIND[i.kind].label} />
                              <div style={{ minWidth: 0 }}>
                                <div className="w6 clamp2" style={{ lineHeight: '21px' }}>{i.title}</div>
                                <div className="mono c3 ellipsis" style={{ marginTop: 4 }}>{i.lines.length ? i.lines.map((l) => l.split('|')[1]).slice(0, 3).join(', ') : KIND[i.kind].label}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ verticalAlign: 'top', paddingTop: 16 }}>
                            <div className={`reason ${open.has(i.id) ? '' : 'clamp'}`}>{i.message}</div>
                            {i.message && i.message.length > 110 && (
                              <button type="button" className="link t12" style={{ marginTop: 2 }} onClick={(e) => { e.stopPropagation(); setOpen((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; }); }}>
                                {open.has(i.id) ? 'Show less' : 'Read more'}
                              </button>
                            )}
                          </td>
                          <td style={{ verticalAlign: 'top', paddingTop: 16 }}><Effect e={i.effect} /></td>
                          <td style={{ verticalAlign: 'top', paddingTop: 14 }}>
                            <Status status={i.status} />
                            <div className="row t12 c3" style={{ gap: 8, marginTop: 8 }}>
                              {valid.length > 0 && <span className="avatars">{valid.map((s) => <Avatar key={s.id} id={s.actor} size={22} />)}</span>}
                              {valid.length < i.requiredSignoffs.length && <span>Needs {i.requiredSignoffs.includes('partner') ? 'partner' : 'reviewer'}</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {chosen.length > 0 && (
            <div className="bulk">
              <span className="w5">{chosen.length} selected</span>
              {bulk.correct.length > 0 && <button type="button" className="btn sm primary" onClick={() => run('correct')}>Apply {bulk.correct.length} corrections</button>}
              {bulk.accept.length > 0 && <button type="button" className="btn sm primary" onClick={() => run('accept')}>Accept {bulk.accept.length} recommendations</button>}
              {bulk.explain.length > 0 && <button type="button" className="btn sm" onClick={() => run('explain')}>Explain {bulk.explain.length}</button>}
              {bulk.sign.length > 0 && ['reviewer', 'partner'].includes(actor?.role) && <button type="button" className="btn sm" onClick={() => run('sign')}>Sign off {bulk.sign.length}</button>}
              <button type="button" className="btn sm icon" onClick={() => setSel(new Set())} aria-label="Clear selection"><X size={14} /></button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
