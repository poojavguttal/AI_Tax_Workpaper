import { useState } from 'react';
import { Check, CheckCircle2, Circle, AlertCircle, Undo2, ExternalLink, ChevronLeft, ChevronRight, ChevronDown, Sparkles, Star, Wrench, Gavel, Flag, FileSearch, ClipboardCheck, ArrowRight } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { packet, line as lineOf, factOfObs } from '../state/base.js';
import { KIND, lineValue, fmtDateTime, money, signed, ROLE_LABEL, ACTION_WORDS } from '../format.js';
import { Status, Signed, Person, Avatar, Crumbs, Sensitive, Empty, fedOf, caOf, payOf } from '../components/ui.jsx';
import { sourceName, showValue } from '../components/Trace.jsx';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';
import { TABS } from './Queue.jsx';
import { Questions, AssignBox } from '../components/People.jsx';

const ROLE = { primary: 'Primary', duplicate: 'Duplicate', included_in: 'Already included', superseded: 'Superseded', supporting: 'Supporting', part: 'Part', component: 'Component' };

function Evidence({ refs }) {
  const { openTrace } = useWorkpaper();
  if (!refs.length) return <Empty title="No evidence references" />;
  return (
    <div className="col" style={{ gap: 10 }}>
      {refs.map((ref) => {
        const o = packet.index.observations.get(ref);
        const l = !o && lineOf(ref);
        const pg = ref.match(/^doc:(D\d+)#page(\d+)$/);
        const doc = packet.index.documents.get(ref);
        const role = factOfObs.get(ref)?.member.role;
        let src = 'Reference';
        let tile = 'REF';
        let what = ref;
        let value = '';
        if (o) {
          src = sourceName(o); what = o.label; tile = src.match(/^D\d+/)?.[0] ?? { Organizer: 'ORG', Questionnaire: 'Q&A', 'Client message': 'MSG', 'Call notes': 'CALL', 'Agency record': 'IRS', 'Prior year': '2024' }[src] ?? 'REF';
          value = o.value_type === 'ssn' ? <Sensitive value={o.value} field={o.id} /> : typeof o.value === 'string' && o.value.length > 28 ? '' : showValue(o.value, o.value_type);
        } else if (l) { src = 'Return line'; what = l.label; value = lineValue(l.value, l.key); tile = 'LINE'; }
        else if (pg) { src = `${pg[1]} · page ${pg[2]}`; what = 'Page the pipeline never read'; tile = pg[1]; }
        else if (doc) { src = doc.id; what = doc.title; tile = doc.id; }
        return (
          <div key={ref} className="ev" onClick={() => openTrace({ ref })}>
            <span className="tile">{tile}</span>
            <div className="grow">
              <div className="w5" style={{ lineHeight: '20px' }}>{what}</div>
              {o && typeof o.value === 'string' && o.value.length > 28 && <div className="t12 c2 mt8">“{o.value}”</div>}
              <div className="t12 c3" style={{ marginTop: 2 }}>{src}{role && role !== 'primary' ? ` · ${ROLE[role]}` : ''}{o?.confidence !== undefined && o?.confidence !== null && o.confidence < 0.9 ? ` · read with ${Math.round(o.confidence * 100)}% confidence` : ''}</div>
            </div>
            {value !== '' && <span className="num w6">{value}</span>}
            <ExternalLink size={14} className="c4" />
          </div>
        );
      })}
    </div>
  );
}

const quickFor = (item) => (item.check === 'document_unaccounted' ? ['Engagement record, not a return input', 'Identity verification', 'Evidence for a linked finding']
  : item.check === 'prior_year_variance' ? ['New employer and stock compensation', 'Move from California to Texas', 'Sale of the Austin condo', 'Explained by linked findings']
    : item.check === 'engine_diagnostic' ? ['Resolved through the linked findings', 'Informational, reviewed'] : ['Client advised in writing', 'Outside the engagement, referred']);

function Effects({ effect, extra = [] }) {
  const tiles = [...extra, ['Federal tax', fedOf(effect), false], ['California tax', caOf(effect), false]];
  if (payOf(effect)) tiles.push(['Payments credited', payOf(effect), true]);
  return (
    <div className="metric-grid">
      {tiles.map(([k, v, p]) => <div key={k} className="metric"><div className="k">{k}</div><div className="v">{typeof v === 'number' ? <Signed value={v} payments={p} /> : v}</div></div>)}
    </div>
  );
}

/** The middle column: what the system proposes. It never closes anything. */
function Proposal({ item, alt, setAlt }) {
  const rec = item.recommendation;
  const c = item.closing;
  const key = item.lines[0]?.split('|')[1];
  const [showAlts, setShowAlts] = useState(true);

  if (item.kind === 'error') {
    return (
      <div className="card">
        <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><Wrench size={16} /></span><div className="h3">Proposed correction</div></div></div>
        <div className="card-b">
          <div className="rec-card">
            <span className="badge-rec"><Sparkles size={13} /> From the evidence</span>
            <div className="h3 mt12">{key && typeof item.expected === 'number' ? <>Change <span className="mono">{key}</span> to {lineValue(item.expected, key)}</> : 'Correct the return line'}</div>
            <div className="c3 mt8">The finding stays open until someone applies the correction and the reviewers sign off.</div>
            <div className="mt16"><Effects effect={item.effect} /></div>
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === 'conflict' || item.kind === 'judgment') {
    const r = item.alternatives[rec?.alternative];
    const others = item.alternatives.map((a, i) => [a, i]).filter(([, i]) => i !== rec?.alternative);
    const Alt = ([a, i]) => (
      <label key={i} className={`alt ${c?.payload?.alternative === i ? 'chosen' : !c && alt === i ? 'on' : ''}`}>
        <input type="radio" className="check" name={item.id} checked={alt === i} disabled={Boolean(c)} onChange={() => setAlt(i)} style={{ marginTop: 3 }} />
        <div>
          <div className="w5">{a.treatment}</div>
          <div className="row t12 mt8 wrap" style={{ gap: 14 }}>
            <span><span className="c3">Federal </span><Signed value={fedOf(a.effect)} /></span>
            <span><span className="c3">California </span><Signed value={caOf(a.effect)} /></span>
            {payOf(a.effect) !== 0 && <span><span className="c3">Payments </span><Signed value={payOf(a.effect)} payments /></span>}
          </div>
        </div>
      </label>
    );
    return (
      <div className="card">
        <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><Sparkles size={16} /></span><div className="h3">Recommendation</div></div><span className="t12 c3">{item.alternatives.length} options</span></div>
        <div className="card-b">
          {rec && (
            <label className={`rec-card ${!c && alt === rec.alternative ? '' : ''}`} style={{ display: 'block', cursor: c ? 'default' : 'pointer', ...(alt === rec.alternative ? {} : { borderColor: 'var(--border)', background: 'var(--bg)' }) }}>
              <div className="between">
                <span className="badge-rec"><Star size={12} fill="currentColor" /> Recommended</span>
                <input type="radio" className="check" name={item.id} checked={alt === rec.alternative} disabled={Boolean(c)} onChange={() => setAlt(rec.alternative)} style={{ width: 18, height: 18 }} />
              </div>
              <div className="h3 mt12">{rec.treatment ?? r?.treatment ?? `Use ${typeof rec.value === 'number' ? money(rec.value) : rec.value}`}</div>
              {rec.rationale && <div className="c2 mt8">{rec.rationale}</div>}
              <div className="mt16"><Effects effect={r?.effect ?? item.effect} /></div>
              {rec.authority && <div className="t12 c3 mt12"><span className="w6 c2">Authority</span> · {rec.authority}</div>}
            </label>
          )}
          {others.length > 0 && (
            <>
              <button type="button" className="btn block mt16" style={{ borderStyle: 'dashed', background: 'var(--subtle)', boxShadow: 'none' }} onClick={() => setShowAlts(!showAlts)}>
                <ChevronDown size={15} style={{ transform: showAlts ? 'rotate(180deg)' : 'none' }} /> {showAlts ? 'Hide' : 'Show'} alternative options ({others.length})
              </button>
              {showAlts && <div className="col mt12" style={{ gap: 10 }}>{(rec ? others : item.alternatives.map((a, i) => [a, i])).map(Alt)}</div>}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><ClipboardCheck size={16} /></span><div className="h3">{item.kind === 'outside_filing' ? 'Obligation outside this return' : 'What needs to be recorded'}</div></div></div>
      <div className="card-b">
        <div className="c2">{KIND[item.kind]?.help}</div>
        {item.due && <div className="callout amber mt16"><span className="w6">Due</span> · {item.due}</div>}
        {(fedOf(item.effect) || caOf(item.effect) || payOf(item.effect)) ? <div className="mt16"><Effects effect={item.effect} /></div> : null}
      </div>
    </div>
  );
}

/** The right column: the human decision, and who has to sign. */
function Decision({ item, alt }) {
  const { actor, dispatch, state } = useWorkpaper();
  const rec = item.recommendation;
  const c = item.closing;
  const [rationale, setRationale] = useState('');
  const [authority, setAuthority] = useState(item.kind === 'judgment' ? rec?.authority ?? '' : '');
  const [reason, setReason] = useState('');
  const canAct = actor?.kind === 'staff' && ['preparer', 'reviewer', 'partner'].includes(actor.role);
  const canUndo = c && (c.actor === actor?.id || ['reviewer', 'partner'].includes(actor?.role));
  const judgment = item.kind === 'judgment';
  const verb = { explanation: 'explain', acknowledgement: 'acknowledge' }[item.requires.action] ?? 'dispose';
  const partner = item.requires.signoff === 'partner';

  let form = null;
  if (!c && canAct) {
    if (item.kind === 'error') {
      form = (
        <>
          <label className="field sect"><span>Note for the reviewer</span><textarea className="textarea" placeholder="Optional" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className="btn primary lg block mt16" onClick={() => dispatch({ kind: 'correct', target: item.id, payload: { reason: reason || item.title } }, { label: 'Correction applied' })}><Check size={17} /> Apply correction</button>
          {['reviewer', 'partner'].includes(actor?.role) && <button type="button" className="btn block mt8" onClick={() => { const r = window.prompt('Why does this finding not apply?'); if (r) dispatch({ kind: 'dismiss', target: item.id, payload: { reason: r } }, { label: 'Finding dismissed' }); }}>Dismiss with a reason</button>}
        </>
      );
    } else if (item.kind === 'conflict' || judgment) {
      form = (
        <>
          <label className="field sect"><span>Rationale</span><textarea className="textarea" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="What you relied on, and why" /></label>
          {rec?.rationale && !rationale && <button type="button" className="link t12 mt8" onClick={() => setRationale(rec.rationale)}>Use the recommendation's reasoning</button>}
          {judgment && <label className="field sect"><span>Authority relied on</span><input className="input" value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder="Code section, regulation or ruling" /></label>}
          <button type="button" className="btn primary lg block mt16" disabled={alt === null || !rationale || (judgment && !authority)}
            onClick={() => dispatch({ kind: 'decide', target: item.id, payload: { alternative: alt, rationale, ...(judgment ? { authority } : {}) } }, { label: 'Decision recorded' })}>
            <Check size={17} /> {alt === rec?.alternative ? 'Accept recommendation' : 'Record decision'}
          </button>
          {alt === null && <div className="t12 c3 mt8 right">Choose an option first.</div>}
        </>
      );
    } else if (item.kind !== 'adjustment') {
      form = (
        <>
          <div className="sect"><span className="cap">Common reasons</span><div className="row wrap" style={{ gap: 8 }}>{quickFor(item).map((t) => <button type="button" key={t} className={`btn sm ${reason === t ? 'soft' : ''}`} onClick={() => setReason(t)}>{t}</button>)}</div></div>
          <label className="field sect"><span>{verb === 'explain' ? 'Why it changed from last year' : 'Explanation'}</span><textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className="btn primary lg block mt16" disabled={!reason} onClick={() => dispatch({ kind: verb, target: item.id, payload: { reason, explanation: reason, note: reason } }, { label: 'Saved' })}><Check size={17} /> Save</button>
        </>
      );
    }
  }

  return (
    <div className="card">
      <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><Gavel size={16} /></span><div className="h3">Review decision</div></div></div>
      <div className="card-b">
        {actor && (
          <div className="who">
            <Avatar id={actor.id} size={40} />
            <div className="grow"><div className="w6">{actor.name}</div><div className="t12 c3">{ROLE_LABEL[actor.role]}{actor.credential ? `, ${actor.credential}` : ''}</div></div>
          </div>
        )}
        <div className="sect"><AssignBox target={item.id} compact /></div>
        <div className="sect">
          <span className="cap">Required before it closes</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="pill blue">{{ correction: 'Correction', decision: 'Decision', disposition: 'Disposition', explanation: 'Explanation', acknowledgement: 'Acknowledgement' }[item.requires.action] ?? 'Action'}</span>
            {judgment && <span className="pill blue">Cited authority</span>}
            <span className="pill blue">Reviewer sign-off</span>
            {partner && <span className="pill amber"><Flag size={12} /> Partner sign-off · effect over {money(state.standards.partner_threshold)}</span>}
            {item.blocking && <span className="pill gray">Blocks filing</span>}
          </div>
        </div>

        {c && (
          <div className="callout green sect">
            <div className="between">
              <div className="row"><CheckCircle2 size={16} className="green" /><span className="w6">{ACTION_WORDS[c.kind]}</span></div>
              {canUndo && <button type="button" className="btn sm ghost" onClick={() => dispatch({ kind: 'revert', target: c.id }, { label: 'Undone', undoable: false })}><Undo2 size={14} /> Undo</button>}
            </div>
            <div className="row t12 c3 mt8"><Person id={c.actor} /> · {fmtDateTime(c.at)}</div>
            {c.kind === 'decide' && <div className="mt8"><div className="w5">{item.alternatives[c.payload.alternative]?.treatment}</div><div className="c2 mt8">{c.payload.rationale}</div>{c.payload.authority && <div className="t12 c3 mt8">Authority: {c.payload.authority}</div>}</div>}
            {['dispose', 'explain', 'acknowledge', 'dismiss', 'correct'].includes(c.kind) && (c.payload.reason ?? c.payload.explanation ?? c.payload.note) && <div className="c2 mt8">{c.payload.reason ?? c.payload.explanation ?? c.payload.note}</div>}
          </div>
        )}
        {form}
        {!c && !canAct && <div className="callout sect c3">Preparers, reviewers and partners record the {item.requires.action}. You can read everything here.</div>}

        <div className="sect">
          <span className="cap">Sign-off</span>
          <Signoff item={item} />
        </div>
      </div>
    </div>
  );
}

function Signoff({ item }) {
  const { actor, dispatch } = useWorkpaper();
  const c = item.closing;
  const valid = (lv) => item.signoffs.filter((s) => s.payload.level === lv && !item.stale.includes(s.id)).at(-1);
  const stale = (lv) => item.signoffs.filter((s) => s.payload.level === lv && item.stale.includes(s.id)).at(-1);
  const rung = (title, lv) => {
    const required = !lv || item.requiredSignoffs.includes(lv);
    const done = lv ? valid(lv) : c;
    const st = lv && !done && stale(lv);
    const canSign = lv && required && !done && c && actor?.kind === 'staff' && c.actor !== actor.id
      && (lv === 'reviewer' ? ['reviewer', 'partner'].includes(actor.role) : actor.role === 'partner');
    return (
      <div className="rung" key={title}>
        {done ? <CheckCircle2 size={18} className="green" /> : st ? <AlertCircle size={18} className="red" /> : <Circle size={18} style={{ color: 'var(--border-strong)' }} />}
        <div>
          <div className="w5">{title}</div>
          <div className="t12 c3">
            {!required ? 'Not required for this item' : done ? <span className="row" style={{ gap: 6 }}><Person id={done.actor} size={16} /> · {fmtDateTime(done.at)}</span>
              : st ? <span className="red">Changed after it was signed. Sign again.</span> : lv ? (c ? 'Waiting' : 'Needs a correction or decision first') : 'Not yet'}
          </div>
        </div>
        {canSign ? <button type="button" className="btn sm" onClick={() => dispatch({ kind: 'signoff', target: item.id, payload: { level: lv } }, { label: `Signed off as ${lv}` })}>Sign off</button> : <span />}
      </div>
    );
  };
  return <div className="ladder">{rung('Prepared')}{rung('Reviewer', 'reviewer')}{rung('Partner', 'partner')}</div>;
}

function Notes({ item }) {
  const { state, dispatch, actor } = useWorkpaper();
  const [text, setText] = useState('');
  const [blocking, setBlocking] = useState(true);
  const notes = state.notes.filter((n) => n.target === item.id);
  return (
    <div style={{ padding: '20px 24px' }}>
      {notes.length === 0 && <div className="c3 mb16">No notes yet.</div>}
      {notes.map((n) => (
        <div key={n.id} className="mb16" style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div className="between">
            <div className="row"><Person id={n.actor} /><span className="t12 c4">{fmtDateTime(n.at)}</span>{n.payload.blocking && !n.resolved && <span className="pill amber">Blocks filing</span>}</div>
            {n.resolved ? <span className="pill green">Resolved</span> : <button type="button" className="btn sm" onClick={() => dispatch({ kind: 'resolve_note', target: n.id }, { label: 'Note resolved' })}>Resolve</button>}
          </div>
          <div className="mt8">{n.payload.text}</div>
        </div>
      ))}
      {actor?.kind === 'staff' && (
        <div className="col gap12">
          <textarea className="textarea" placeholder="Add a review note or a question for a colleague" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="between">
            <label className="row t12 c2"><input type="checkbox" className="check" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} /> Block filing until resolved</label>
            <button type="button" className="btn sm" disabled={!text} onClick={() => { dispatch({ kind: 'note', target: item.id, payload: { text, blocking } }, { label: 'Note added' }); setText(''); }}>Add note</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Finding({ params }) {
  const { state, openTrace } = useWorkpaper();
  const item = state.itemsById.get(params.id);
  if (!item) return <><Header><Crumbs items={[['Review', ['queue']], ['Not found']]} /></Header><Empty title="This item does not exist" /></>;
  return <FindingPage key={item.id + (item.closing?.id ?? '')} item={item} state={state} openTrace={openTrace} />;
}

function FindingPage({ item, state, openTrace }) {
  const [tab, setTab] = useState('notes');
  const [alt, setAlt] = useState(item.closing?.payload?.alternative ?? item.recommendation?.alternative ?? null);
  const sameKind = state.items.filter((i) => i.kind === item.kind);
  const idx = sameKind.findIndex((i) => i.id === item.id);
  const go = (d) => { const n = sameKind[idx + d]; if (n) navigate('finding', { id: n.id }); };
  const tabLabel = TABS.find(([, , ks]) => ks.length === 1 && ks[0] === item.kind)?.[1] ?? 'Findings';
  const history = state.log.filter((l) => l.event.target === item.id || state.notes.some((n) => n.id === l.event.target && n.target === item.id));
  const notes = state.notes.filter((n) => n.target === item.id);
  const key = item.lines[0]?.split('|')[1];
  const effects = [['Federal', fedOf(item.effect)], ['California', caOf(item.effect)]].filter(([, v]) => v);
  const head = effects.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const pay = payOf(item.effect);
  const fmt = (v) => (typeof v === 'number' && key ? lineValue(v, key) : v === null || v === undefined ? '—' : String(v));

  return (
    <>
      <Header right={
        <div className="row">
          <span className="t12 c3 num">{idx + 1} of {sameKind.length}</span>
          <button type="button" className="btn sm icon" disabled={idx <= 0} onClick={() => go(-1)} aria-label="Previous"><ChevronLeft size={16} /></button>
          <button type="button" className="btn sm icon" disabled={idx >= sameKind.length - 1} onClick={() => go(1)} aria-label="Next"><ChevronRight size={16} /></button>
        </div>
      }>
        <Crumbs items={[['Review', ['queue']], [tabLabel, ['queue', { kind: item.kind }]], [item.title]]} />
      </Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head" style={{ alignItems: 'flex-start' }}>
            <div className="grow" style={{ maxWidth: 920 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="pill outline"><span className="dot" style={{ background: KIND[item.kind]?.color }} />{KIND[item.kind]?.label}</span>
                <Status status={item.status} />
                {!item.blocking && <span className="pill gray">Does not block filing</span>}
              </div>
              <h1 className="h1 mt12">{item.title}</h1>
              <div className="sub">{item.message}</div>
            </div>
            {head ? <div className="stat" style={{ minWidth: 220 }}><div className="top"><span className="cap">{head[0]} tax</span></div><div className="v"><Signed value={head[1]} /></div><div className="s">Estimated, {item.effect?.method === 'what_if' ? "engine's what-if" : "engine's per-dollar rates"}</div></div>
              : pay ? <div className="stat" style={{ minWidth: 220 }}><div className="top"><span className="cap">Payments</span></div><div className="v"><Signed value={pay} payments /></div><div className="s">Credited, one for one</div></div> : null}
          </div>

          <div className="detail-grid">
            <div className="col gap20">
              <div className="card">
                <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><FileSearch size={16} /></span><div className="h3">What the evidence shows</div></div><span className="t12 c3">{item.evidence.length} sources</span></div>
                <div className="card-b">
                  <div className="accent">
                    <div className="cap mb8">On the return</div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {item.lines.length ? item.lines.map((l) => <button key={l} type="button" className="ref" onClick={() => openTrace({ ref: l.split('|')[1] })}>{l.split('|')[1]}</button>) : <span className="c3">No single line</span>}
                    </div>
                    {(item.engine !== null || item.expected !== null) && (
                      <div className="row mt12" style={{ gap: 24 }}>
                        <div><div className="t12 c3">Reported</div><div className="w6 num">{fmt(item.engine)}</div></div>
                        <ArrowRight size={16} className="c4" />
                        <div><div className="t12 c3">{item.kind === 'error' ? 'Supported by evidence' : 'Recommended'}</div><div className="w6 num green">{fmt(item.expected)}</div></div>
                      </div>
                    )}
                  </div>
                  <div className="sect"><span className="cap">Sources</span><Evidence refs={item.evidence} /></div>
                </div>
              </div>

              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="tabs" style={{ padding: '0 12px' }}>
                  {[['notes', 'Notes', notes.length], ['questions', 'Questions', state.questions.filter((q) => q.target === item.id).length], ['history', 'History', history.length]].map(([k, l, n]) => (
                    <button type="button" key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}<span className="n">{n}</span></button>
                  ))}
                </div>
                {tab === 'notes' && <Notes item={item} />}
                {tab === 'questions' && <Questions target={item.id} />}
                {tab === 'history' && (history.length === 0 ? <Empty title="No activity yet" /> : (
                  <table className="tbl"><tbody>
                    {history.map((l) => (
                      <tr key={l.event.id}>
                        <td style={{ width: 200 }}><Person id={l.event.actor} /></td>
                        <td>{ACTION_WORDS[l.event.kind]}{l.event.payload?.level ? ` as ${l.event.payload.level}` : ''}{l.status === 'rejected' && <div className="t12 red">Refused: {l.reason}</div>}{l.status === 'reverted' && <span className="c3"> · undone</span>}</td>
                        <td className="r t12 c3 num">{fmtDateTime(l.event.at)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                ))}
              </div>
            </div>

            <Proposal item={item} alt={alt} setAlt={setAlt} />
            <Decision item={item} alt={alt} />
          </div>
        </div>
      </div>
    </>
  );
}

export { signed };
