import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { linesOf, resultsByLine, packet } from '../state/base.js';
import { lineValue, money, signed } from '../format.js';
import { Crumbs } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { LineTrace } from '../components/Trace.jsx';
import { navigate } from '../state/router.js';

const FORM_NAMES = {
  F1040: 'Form 1040 · Individual income tax return', Sch1: 'Schedule 1 · Additional income and adjustments', Sch2: 'Schedule 2 · Additional taxes',
  Sch3: 'Schedule 3 · Additional credits and payments', SchA: 'Schedule A · Itemized deductions', SchB: 'Schedule B · Interest and dividends',
  SchC: 'Schedule C · Lindqvist Studio', SchD: 'Schedule D · Capital gains and losses', SchE: 'Schedule E · Rentals, partnerships, S corporations',
  SchSE: 'Schedule SE · Self-employment tax', F8949: 'Form 8949 · Sales and dispositions', 'F4562-C': 'Form 4562 · Studio depreciation',
  'F4562-E': 'Form 4562 · Rental depreciation', F4797: 'Form 4797 · Sale of the Austin condo', F8582: 'Form 8582 · Passive activity losses',
  F6251: 'Form 6251 · Alternative minimum tax', F8606: 'Form 8606 · Nondeductible IRAs', F8812: 'Schedule 8812 · Child tax credit',
  F8863: 'Form 8863 · Education credits', F2441: 'Form 2441 · Dependent care', F8889: 'Form 8889 · HSA', F8283: 'Form 8283 · Noncash contributions',
  F7203: 'Form 7203 · S corporation basis', F8938: 'Form 8938 · Foreign financial assets', F8959: 'Form 8959 · Additional Medicare tax',
  F8960: 'Form 8960 · Net investment income tax', F8995: 'Form 8995 · Qualified business income', F2210: 'Form 2210 · Underpayment penalty',
  F8867: 'Form 8867 · Due diligence', SchCA540NR: 'Schedule CA (540NR) · California adjustments', F540NR: 'Form 540NR · California return',
  ScheduleS: 'Schedule S · Other state tax credit', FTB3885A: 'FTB 3885A · California depreciation', FTB5805: 'FTB 5805 · California underpayment',
};
const BOX = { A: 'Box A · Short-term, basis reported', B: 'Box B · Short-term, basis not reported', D: 'Box D · Long-term, basis reported', E: 'Box E · Long-term, basis not reported', F: 'Box F · Long-term, no Form 1099-B', H: 'Box H · Short-term digital assets', K: 'Box K · Long-term digital assets' };
const SUMMARY = ['F1040.1z', 'F1040.2b', 'F1040.3b', 'F1040.4b', 'F1040.7', 'F1040.8', 'F1040.9', 'F1040.10', 'F1040.11', 'F1040.12', 'F1040.13', 'F1040.15', 'F1040.16', 'F1040.19', 'F1040.23', 'F1040.24', 'F1040.25a', 'F1040.26', 'F1040.33', 'F1040.37'];
const KEY_FIGS = {
  federal: [['F1040.9', 'Total income'], ['F1040.11', 'Adjusted gross income'], ['F1040.15', 'Taxable income'], ['F1040.24', 'Total tax'], ['F1040.33', 'Total payments'], ['F1040.37', 'Amount owed']],
  california: [['F540NR.17', 'Total AGI, CA law'], ['F540NR.32', 'California AGI'], ['F540NR.35', 'CA taxable income'], ['F540NR.64', 'Total tax'], ['F540NR.78', 'Total payments'], ['F540NR.97', 'Overpaid']],
};

/** "Schedule C · Lindqvist Studio" → prefix, code, title for the form header band. */
function formParts(form) {
  const [name, title = ''] = (FORM_NAMES[form] ?? form).split(' · ');
  const i = name.lastIndexOf(' ');
  return i > 0 ? { prefix: name.slice(0, i), code: name.slice(i + 1), title, name } : { prefix: 'Form', code: name, title, name };
}
const isTotal = (l) => /^(total|adjusted gross income|taxable income|amount you owe|overpaid|net profit|net)/i.test(l.label);
const lineNo = (l) => l.key.split('.').slice(1).join('.');

export function Return({ params }) {
  const { state, openTrace } = useWorkpaper();
  const [view, setView] = useState('federal');
  const [q, setQ] = useState('');
  const lines = linesOf();
  const sel = params.line;
  const eff = new Map(state.return.lines.map((l) => [l.key, l]));
  const forms = useMemo(() => {
    const m = new Map();
    for (const l of lines) { if (!m.has(l.form)) m.set(l.form, { form: l.form, j: l.jurisdiction, lines: [] }); m.get(l.form).lines.push(l); }
    return [...m.values()];
  }, [lines]);
  const selForm = sel ? packet.index.lines.get(`v3|${sel}`)?.form : null;
  const [picked, setPicked] = useState(selForm ?? 'F1040');
  const openItems = (key) => (resultsByLine.get(key) ?? []).map((id) => state.itemsById.get(id)).filter((i) => i && ['error', 'conflict', 'judgment'].includes(i.kind) && i.status !== 'closed');
  const pick = (key) => navigate('return', { line: key });
  const shown = forms.filter((f) => f.j === view);
  const current = shown.find((f) => f.form === picked) ?? shown[0];
  const flagsOf = (f) => f.lines.reduce((n, l) => n + openItems(l.key).length, 0);
  const valueOf = (key) => eff.get(key)?.effective ?? packet.index.lines.get(`v3|${key}`)?.value;
  const switchView = (v) => { setView(v); const first = forms.find((f) => f.j === v); if (first) setPicked(first.form); };

  const Amount = ({ l }) => {
    const e = eff.get(l.key);
    return e ? <><span className="strike" style={{ marginRight: 8 }}>{lineValue(l.value, l.key)}</span><span className="green w6">{lineValue(e.effective, l.key)}</span></> : lineValue(l.value, l.key);
  };
  const Flag = ({ l }) => {
    const items = openItems(l.key);
    if (!items.length) return null;
    return <button type="button" className="pill red" style={{ cursor: 'pointer' }} title={items.map((i) => i.title).join('\n')} onClick={(e) => { e.stopPropagation(); navigate('finding', { id: items[0].id }); }}><span className="dot" style={{ background: 'var(--red)' }} />{items.length} open</button>;
  };
  const Row = ({ l, showForm }) => (
    <tr className={`click ${sel === l.key ? 'sel' : ''} ${!showForm && isTotal(l) ? 'tot' : ''}`} onClick={() => pick(l.key)}>
      <td className="tf-ln">{showForm ? <span className="t12">{formParts(l.form).code}</span> : lineNo(l)}</td>
      <td><div className="tf-label"><span title={l.label}>{showForm && <span className="mono c3" style={{ marginRight: 8 }}>{lineNo(l)}</span>}{l.label}</span><i /></div></td>
      <td className="tf-amt">{Amount({ l })}</td>
      <td style={{ paddingLeft: 12 }}>{Flag({ l })}</td>
    </tr>
  );
  const Sheet = ({ f }) => {
    const { prefix, code, title } = formParts(f.form);
    const boxes = new Map();
    if (f.form === 'F8949') for (const l of f.lines) { const b = l.key.split('.')[1]; if (!boxes.has(b)) boxes.set(b, []); boxes.get(b).push(l); }
    return (
      <div className="tf sheet-form">
        <div className="tf-head">
          <div className="tf-code"><span>{prefix}</span>{code}</div>
          <div className="tf-title"><div className="w6">{title || FORM_NAMES[f.form]}</div><div className="t12 c3">{f.j === 'federal' ? 'Department of the Treasury · Internal Revenue Service' : 'Franchise Tax Board'} · Engine v3</div></div>
          <div className="tf-year">2025</div>
        </div>
        <table className="tf-tbl">
          <colgroup><col style={{ width: 72 }} /><col /><col style={{ width: sel ? 140 : 200 }} /><col style={{ width: 100 }} /></colgroup>
          <thead><tr><th style={{ textAlign: 'center' }}>Line</th><th style={{ textAlign: 'left', paddingLeft: 14 }}>Description</th><th>Amount</th><th /></tr></thead>
          <tbody>
            {f.form !== 'F8949' ? f.lines.map((l) => <Row key={l.key} l={l} />) : [...boxes].flatMap(([b, ls]) => [
              <tr key={b} className="tf-part"><td colSpan={4}>{BOX[b] ?? `Box ${b}`}<span className="c3" style={{ fontWeight: 400 }}> · {ls.filter((l) => !l.key.endsWith('.total')).length} sales</span></td></tr>,
              ...ls.filter((l) => !l.key.endsWith('.total')).slice(0, 300).map((l) => <Row key={l.key} l={l} />),
              ...ls.filter((l) => l.key.endsWith('.total')).map((l) => (
                <tr key={l.key} className={`last click ${sel === l.key ? 'sel' : ''}`} onClick={() => pick(l.key)}>
                  <td className="tf-ln">{b}</td><td><div className="tf-label"><span>Totals, box {b}</span><i /></div></td><td className="tf-amt">{Amount({ l })}</td><td />
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    );
  };

  const search = q && shown.flatMap((f) => f.lines).filter((l) => `${l.key} ${l.label}`.toLowerCase().includes(q.toLowerCase()));

  const compare = (
    <div className="tf sheet-form">
      <div className="tf-head">
        <div className="tf-code"><span>Form</span>1040</div>
        <div className="tf-title"><div className="w6">2025 compared with the 2024 return as filed</div><div className="t12 c3">Changes over $1,000 and 10% are highlighted for the prior-year review</div></div>
        <div className="tf-year">2025</div>
      </div>
      <table className="tf-tbl">
        <colgroup><col style={{ width: 72 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 170 }} /><col style={{ width: 140 }} /></colgroup>
        <thead><tr><th style={{ textAlign: 'center' }}>Line</th><th style={{ textAlign: 'left', paddingLeft: 14 }}>Description</th><th>2024 as filed</th><th>2025</th><th>Change</th></tr></thead>
        <tbody>
          {SUMMARY.map((k) => {
            const l = packet.index.lines.get(`v3|${k}`);
            if (!l) return null;
            const py = packet.raw.prior_years.return_2024.lines;
            const before = py[k] ?? (k === 'F1040.1z' ? py['F1040.1a'] : undefined);
            const now = eff.get(k)?.effective ?? l.value;
            const d = typeof before === 'number' ? now - before : null;
            const big = d !== null && Math.abs(d) > 1000 && (before === 0 || Math.abs(d / before) > 0.1);
            return (
              <tr key={k} className={`click ${sel === k ? 'sel' : ''} ${['F1040.11', 'F1040.24'].includes(k) ? 'last' : ''}`} onClick={() => pick(k)}>
                <td className="tf-ln">{lineNo(l)}</td>
                <td><div className="tf-label"><span>{l.label}</span><i /></div></td>
                <td className="tf-amt c3">{before !== undefined ? money(before) : '—'}</td>
                <td className="tf-amt adj">{Amount({ l })}</td>
                <td className={`tf-amt ${big ? 'amber w6' : 'c2'}`}>{d === null ? '—' : signed(d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const figs = KEY_FIGS[view === 'california' ? 'california' : 'federal'];

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Return'], ...(sel ? [[sel]] : [])]} /></Header>
      <div className={sel ? 'with-panel' : 'content'} style={sel ? { flex: 1 } : undefined}>
        <div style={sel ? { overflowY: 'auto' } : undefined}>
          <div className="page" style={{ maxWidth: 'none' }}>
            <div className="page-head">
              <div>
                <h1 className="h1">Return</h1>
                <div className="sub">Every line from engine v3, with recorded changes applied. Select a line to see how it was built and trace it to its source.</div>
              </div>
              <div className="seg">
                {[['federal', 'Federal'], ['california', 'California'], ['summary', '2025 vs 2024']].map(([k, l]) => <button type="button" key={k} className={view === k ? 'on' : ''} onClick={() => switchView(k)}>{l}</button>)}
              </div>
            </div>

            <div className="figs mb24">
              {figs.map(([k, label]) => {
                const v = valueOf(k);
                const changed = eff.has(k);
                return (
                  <button type="button" key={k} className={`fig ${sel === k ? 'on' : ''}`} onClick={() => pick(k)}>
                    <span className="cap">{label}</span>
                    <span className={`v ${changed ? 'green' : ''}`}>{money(v)}</span>
                    <span className="t12 c4 mono">{k}</span>
                  </button>
                );
              })}
            </div>

            {view === 'summary' ? compare : (
              <div className="ret-grid" style={sel ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
                {!sel && (
                  <div className="rail ret-rail">
                    <div className="search mb8"><Search size={16} /><input className="input" placeholder="Find a line" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                    {shown.map((f) => {
                      const { name, title } = formParts(f.form);
                      const n = flagsOf(f);
                      return (
                        <button type="button" key={f.form} className={`rail-btn form-btn ${!q && current?.form === f.form ? 'on' : ''}`} onClick={() => { setPicked(f.form); setQ(''); }}>
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="ellipsis">{name}</div>
                            {title && <div className="t12 c3 ellipsis" style={{ fontWeight: 400 }}>{title}</div>}
                          </div>
                          {n > 0 ? <span className="count" style={{ color: 'var(--red)', borderColor: 'var(--red-200)', background: 'var(--red-50)' }}>{n}</span> : <span className="t12 c4">{f.lines.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="col gap16" style={{ minWidth: 0 }}>
                  {sel && (
                    <div className="row" style={{ gap: 12 }}>
                      <select className="select" style={{ maxWidth: 420 }} value={current?.form} onChange={(e) => setPicked(e.target.value)}>
                        {shown.map((f) => <option key={f.form} value={f.form}>{FORM_NAMES[f.form] ?? f.form}{flagsOf(f) ? ` (${flagsOf(f)} open)` : ''}</option>)}
                      </select>
                    </div>
                  )}
                  {search ? (
                    <div className="tf sheet-form">
                      <div className="card-h" style={{ borderBottom: '1.5px solid var(--text)' }}><div className="h3">{search.length} lines match “{q}”</div><button type="button" className="btn sm ghost" onClick={() => setQ('')}><X size={14} /> Clear</button></div>
                      <table className="tf-tbl">
                        <colgroup><col style={{ width: 72 }} /><col /><col style={{ width: sel ? 140 : 200 }} /><col style={{ width: 100 }} /></colgroup>
                        <tbody>{search.slice(0, 200).map((l) => <Row key={l.key} l={l} showForm />)}</tbody>
                      </table>
                    </div>
                  ) : current && <Sheet f={current} />}
                </div>
              </div>
            )}
          </div>
        </div>
        {sel && (
          <div className="panel">
            <div className="panel-h"><span className="h3">Trace</span><button type="button" className="btn sm icon ghost" onClick={() => navigate('return')} aria-label="Close"><X size={16} /></button></div>
            <div className="panel-b">
              <LineTrace key={sel} lineKey={sel} onOpenRef={(ref) => (packet.index.lines.get(`v3|${ref}`) ? pick(ref) : openTrace({ ref }))} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
