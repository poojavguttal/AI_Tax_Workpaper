// CPA schedules: read-only workpapers built from the packet and engine v3, each one
// tied back to the return lines it supports. Every amount opens its source.

import { Fragment, useMemo, useState } from 'react';
import { Search, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { packet, linesOf, line, citedBy, factOfObs, resultsByLine, actorById } from '../state/base.js';
import { money, money2, signed, fmtDate, ACTION_WORDS } from '../format.js';
import { Crumbs } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';

const raw = packet.raw;
const v3 = raw.return_versions.find((v) => v.version === 'v3') ?? raw.return_versions.at(-1);
const num = (s) => Number(String(s).replace(/,/g, ''));
const round = (n) => Math.round(n * 100) / 100;
const humanize = (k) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()).replace(/\bira\b/i, 'IRA').replace(/\bamt\b/i, 'AMT').replace(/\bnol\b/i, 'NOL').replace(/\bqbi\b/i, 'QBI').replace(/\bsep\b/i, 'SEP').replace(/\bscorp\b/i, 'S corp');

const TABS = [
  ['depreciation', 'Depreciation by asset', 'Federal, California and AMT'],
  ['sales', 'Sales detail', 'Form 8949 by box'],
  ['state', 'State split', 'California part-year'],
  ['books', 'Books to tax', 'Lindqvist Studio'],
  ['rentals', 'Rentals and passive', 'Schedule E and Form 8582'],
  ['k1', 'K-1 lines', 'Where each box landed'],
  ['carry', 'Carryovers', 'Into and out of 2025'],
  ['basis', 'Basis by year', 'Stock, capital and IRA'],
  ['prior', 'Prior preparer vs us', 'What changed this year'],
];

/** Where an observation reaches the return, directly or through its fact. */
function landingsOfObs(obsId) {
  const fm = factOfObs.get(obsId);
  const members = fm ? fm.fact.members.map((m) => m.obs) : [obsId];
  const out = new Map();
  for (const m of members) for (const l of citedBy.get(m) ?? []) out.set(l.key, l);
  return [...out.values()];
}

// ── Shared sheet ────────────────────────────────────────────────────────────

function Sheet({ prefix = 'Workpaper', code, title, sub, cols, children, foot, year = 2025 }) {
  return (
    <div className="tf sheet-form mb24">
      <div className="tf-head">
        <div className="tf-code"><span>{prefix}</span>{code}</div>
        <div className="tf-title"><div className="w6">{title}</div>{sub && <div className="t12 c3">{sub}</div>}</div>
        <div className="tf-year">{year}</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tf-tbl sch-tbl">
          <colgroup>{cols.map((c, i) => <col key={i} style={c.w ? { width: c.w } : undefined} />)}</colgroup>
          <thead><tr>{cols.map((c, i) => <th key={i} style={{ textAlign: c.left ? 'left' : 'right', paddingLeft: c.left ? 14 : undefined }}>{c.h}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {foot}
    </div>
  );
}

const Part = ({ span, children }) => <tr className="tf-part"><td colSpan={span}>{children}</td></tr>;

function Label({ main, sub, mono }) {
  return (
    <div className="sch-label">
      <div className="ellipsis" title={typeof main === 'string' ? main : undefined}>{main}</div>
      {sub && <div className={`t12 c3 ellipsis ${mono ? 'mono' : ''}`}>{sub}</div>}
    </div>
  );
}

/** A clickable amount that opens the return line (or a source ref) behind it. */
function Amt({ v, lineKey, refId, fmt = money, tone = '', eff }) {
  const { openTrace } = useWorkpaper();
  const changed = eff && lineKey && eff.has(lineKey);
  const shown = changed ? eff.get(lineKey).effective : v;
  const go = lineKey ? () => navigate('return', { line: lineKey }) : refId ? () => openTrace({ ref: refId }) : null;
  const body = (
    <>
      {changed && <span className="strike t12" style={{ marginRight: 6 }}>{fmt(v)}</span>}
      <span className={changed ? 'green w6' : tone}>{v === null || v === undefined ? '—' : fmt(shown)}</span>
    </>
  );
  return <td className="tf-amt">{go ? <button type="button" className="amt-link" onClick={go} title={lineKey ?? refId}>{body}</button> : body}</td>;
}

function Tie({ ok, children }) {
  return (
    <div className={`tie ${ok ? 'ok' : 'off'}`}>
      {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      <span>{children}</span>
    </div>
  );
}

function useFlags() {
  const { state } = useWorkpaper();
  return (key) => (resultsByLine.get(key) ?? []).map((id) => state.itemsById.get(id)).filter((i) => i && ['error', 'conflict', 'judgment'].includes(i.kind) && i.status !== 'closed');
}

function FlagCell({ lineKeys }) {
  const flags = useFlags();
  const items = [...new Map(lineKeys.flatMap(flags).map((i) => [i.id, i])).values()];
  return (
    <td style={{ paddingLeft: 10 }}>
      {items.length > 0 && (
        <button type="button" className="pill red" style={{ cursor: 'pointer' }} title={items.map((i) => i.title).join('\n')} onClick={() => navigate('finding', { id: items[0].id })}>
          <span className="dot" style={{ background: 'var(--red)' }} />{items.length} open
        </button>
      )}
    </td>
  );
}

// ── Depreciation ────────────────────────────────────────────────────────────

const ASSET_TIES = {
  STU: { fed: 'SchC.13', ca: 'SchCA540NR.12.C', caSign: 1, name: 'Lindqvist Studio (Schedule C)' },
  SAC: { fed: 'SchE.18A', ca: 'SchCA540NR.17.B', caSign: -1, name: '1450 Fremont Way, Sacramento (Schedule E, A)' },
  AUS: { fed: 'SchE.18B', ca: null, name: '1200 Barton Hills Dr 4C, Austin (Schedule E, B)' },
};

function Depreciation() {
  const { openTrace } = useWorkpaper();
  const groups = new Map();
  for (const a of v3.assets) { const g = a.asset_id.split('-')[0]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a); }
  const cols = [{ h: 'Asset · method', left: true }, { h: 'Cost', w: 104 }, { h: 'Federal', w: 112 }, { h: 'California', w: 112 }, { h: 'CA diff', w: 96 }, { h: 'AMT diff', w: 88 }, { h: 'Accumulated', w: 120 }, { h: 'Disposal', left: true, w: 168 }];
  const sum = (list, f) => round(list.reduce((s, a) => s + f(a), 0));
  const all = v3.assets;
  return (
    <>
      <Sheet prefix="Schedule" code="DEP" title="Depreciation by asset" sub="Engine v3 asset books · each asset opens its record and prior-year schedule" cols={cols}>
        {[...groups].map(([g, list]) => {
          const t = ASSET_TIES[g];
          const fed = sum(list, (a) => a.federal.depreciation_2025);
          const ca = sum(list, (a) => a.california.depreciation_2025);
          return (
            <Fragment key={g}>
              <Part span={cols.length}>{t?.name ?? list[0].activity}</Part>
              {list.map((a) => {
                const caDiff = round(a.california.depreciation_2025 - a.federal.depreciation_2025);
                const d = a.disposition;
                return (
                  <tr key={a.asset_id} className="click" onClick={() => openTrace({ ref: `asset:${a.asset_id}` })}>
                    <td><Label main={a.description} sub={`${a.asset_id} · ${fmtDate(a.placed_in_service)} · ${a.method}, ${a.life_years} yr`} /></td>
                    <td className="tf-amt">{money(a.cost)}{a.land_value_not_depreciated ? <div className="t12 c3">land {money(a.land_value_not_depreciated)}</div> : null}</td>
                    <td className="tf-amt">{money2(a.federal.depreciation_2025)}</td>
                    <td className="tf-amt">{money2(a.california.depreciation_2025)}</td>
                    <td className={`tf-amt ${caDiff ? 'amber w6' : 'c4'}`}>{caDiff ? signed(caDiff) : '—'}</td>
                    <td className={`tf-amt ${a.amt.difference_from_regular ? 'amber w6' : 'c4'}`}>{a.amt.difference_from_regular ? signed(a.amt.difference_from_regular) : '—'}</td>
                    <td className="tf-amt">{money2(a.federal.accumulated_end)}{a.california.accumulated_end !== a.federal.accumulated_end && <div className="t12 c3">CA {money2(a.california.accumulated_end)}</div>}</td>
                    <td>{d ? <Label main={`Sold ${fmtDate(d.date)}`} sub={`§1250 unrecaptured ${money(d.unrecaptured_1250_depreciation)}${d.section_1250_ordinary_recapture ? ` · ordinary ${money(d.section_1250_ordinary_recapture)}` : ''}`} /> : <span className="c4" style={{ paddingLeft: 14 }}>In service</span>}</td>
                  </tr>
                );
              })}
              <tr className="last">
                <td><Label main={`Total, ${list.length} assets`} sub={t ? `Ties to ${t.fed}${t.ca ? ` and ${t.ca}` : ''}` : null} mono /></td>
                <td className="tf-amt">{money(sum(list, (a) => a.cost))}</td>
                <Amt v={fed} fmt={money2} lineKey={t?.fed} />
                <td className="tf-amt">{money2(ca)}</td>
                <Amt v={round(ca - fed)} fmt={signed} lineKey={t?.ca ?? undefined} />
                <td className="tf-amt c4">—</td>
                <td className="tf-amt">{money2(sum(list, (a) => a.federal.accumulated_end))}</td><td />
              </tr>
            </Fragment>
          );
        })}
      </Sheet>
      <div className="ties card"><div className="card-h"><div className="h3">Ties to the return</div></div>
        {[...groups].map(([g, list]) => {
          const t = ASSET_TIES[g];
          if (!t) return null;
          const fed = sum(list, (a) => a.federal.depreciation_2025);
          const l = line(t.fed);
          const out = [<Tie key="f" ok={Math.abs(Math.round(fed) - l.value) <= 1}>Federal {money2(fed)} ties to {t.fed} ({money(l.value)})</Tie>];
          if (t.ca) {
            const diff = sum(list, (a) => a.california.depreciation_2025 - a.federal.depreciation_2025) * t.caSign * -1;
            const c = line(t.ca);
            out.push(<Tie key="c" ok={Math.abs(Math.round(Math.abs(diff)) - Math.abs(c.value)) <= 1}>California difference {money2(Math.abs(diff))} ties to {t.ca} ({money(c.value)})</Tie>);
          }
          return out;
        })}
        <Tie ok>{all.filter((a) => a.disposition).length} assets disposed with the Austin condo; unrecaptured §1250 {money2(sum(all.filter((a) => a.disposition), (a) => a.disposition.unrecaptured_1250_depreciation))} carries to Form 4797</Tie>
      </div>
    </>
  );
}

// ── Sales ───────────────────────────────────────────────────────────────────

const BOX = { A: 'Short-term, basis reported', B: 'Short-term, basis not reported', D: 'Long-term, basis reported', E: 'Long-term, basis not reported', F: 'Long-term, no Form 1099-B', H: 'Short-term digital assets', K: 'Long-term digital assets' };
const LOT = /^(.*) \(acquired ([^,]+), sold ([^;]+); proceeds ([\d,.-]+), basis ([\d,.-]+)(?:, adjustment (\w+) ([\d,.-]+))?\)$/;
const TOTALS = /proceeds ([\d,.-]+); basis ([\d,.-]+); adjustments ([\d,.-]+)/;

function parseLot(l) {
  const m = l.label.match(LOT);
  if (!m) return { name: l.label, acquired: '', sold: '', proceeds: null, basis: null, adj: null, code: '' };
  return { name: m[1], acquired: m[2], sold: m[3], proceeds: num(m[4]), basis: num(m[5]), code: m[6] ?? '', adj: m[7] ? num(m[7]) : 0 };
}

function Sales() {
  const { state } = useWorkpaper();
  const flags = useFlags();
  const eff = new Map(state.return.lines.map((l) => [l.key, l]));
  const [open, setOpen] = useState(new Set());
  const [q, setQ] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const boxes = useMemo(() => {
    const m = new Map();
    for (const l of linesOf().filter((x) => x.form === 'F8949')) {
      const b = l.line.split('.')[0];
      if (!m.has(b)) m.set(b, { b, lots: [], total: null });
      if (l.line.endsWith('total')) m.get(b).total = l; else m.get(b).lots.push({ l, ...parseLot(l) });
    }
    return [...m.values()].sort((a, b) => a.b.localeCompare(b.b));
  }, []);
  const gainOf = (l) => eff.get(l.key)?.effective ?? l.value;
  const allLots = boxes.flatMap((x) => x.lots);
  const flaggedLots = allLots.filter((x) => flags(x.l.key).length);
  const toggle = (b) => setOpen((s) => { const n = new Set(s); if (n.has(b)) n.delete(b); else n.add(b); return n; });
  const cols = [{ h: 'Box', w: 64 }, { h: 'Description', left: true }, { h: 'Acquired', w: 110 }, { h: 'Sold', w: 110 }, { h: 'Proceeds', w: 120 }, { h: 'Basis', w: 120 }, { h: 'Adjustment', w: 110 }, { h: 'Gain or (loss)', w: 150 }, { h: '', w: 96 }];
  const match = (x) => (!q || `${x.name} ${x.l.key}`.toLowerCase().includes(q.toLowerCase())) && (!onlyFlagged || flags(x.l.key).length);
  const LotRow = ({ x }) => (
    <tr className="click" onClick={() => navigate('return', { line: x.l.key })}>
      <td className="tf-ln mono t12">{x.l.line}</td>
      <td><Label main={x.name} sub={x.code ? `Code ${x.code}` : null} /></td>
      <td className="tf-amt c2">{x.acquired}</td>
      <td className="tf-amt c2">{x.sold}</td>
      <td className="tf-amt">{money2(x.proceeds)}</td>
      <td className="tf-amt">{money2(x.basis)}</td>
      <td className="tf-amt c2">{x.adj ? money2(x.adj) : '—'}</td>
      <td className="tf-amt">{eff.has(x.l.key) ? <><span className="strike t12" style={{ marginRight: 6 }}>{money2(x.l.value)}</span><span className="green w6">{money2(gainOf(x.l))}</span></> : money2(x.l.value)}</td>
      <FlagCell lineKeys={[x.l.key]} />
    </tr>
  );
  const filtering = q || onlyFlagged;

  return (
    <>
      <div className="row mb16" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="search" style={{ width: 300 }}><Search size={16} /><input className="input" placeholder="Search security or lot" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="row t13 c2" style={{ gap: 8 }}><input type="checkbox" className="check" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />Only lots with open findings ({flaggedLots.length})</label>
        <div className="grow" />
        <button type="button" className="btn sm" onClick={() => setOpen(open.size ? new Set() : new Set(boxes.map((x) => x.b)))}>{open.size ? 'Collapse all' : 'Expand all'}</button>
      </div>
      <Sheet prefix="Form" code="8949" title={`Sales and dispositions · ${allLots.length} lots`} sub="Summarised by box; open a box for every lot. Totals stay one row each so hundreds of sales don't swamp the review." cols={cols}>
        {boxes.map((x) => {
          const t = x.total?.label.match(TOTALS);
          const lots = x.lots.filter(match);
          const isOpen = open.has(x.b) || filtering;
          const nFlag = x.lots.filter((y) => flags(y.l.key).length).length;
          if (filtering && !lots.length) return null;
          return (
            <Fragment key={x.b}>
              <tr className="click sch-box" onClick={() => toggle(x.b)}>
                <td className="tf-ln">{x.b}</td>
                <td><div className="sch-label row" style={{ gap: 8 }}>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<div className="grow" style={{ minWidth: 0 }}><div className="w6 ellipsis">{BOX[x.b] ?? `Box ${x.b}`}</div><div className="t12 c3">{x.lots.length} {x.lots.length === 1 ? 'lot' : 'lots'}{nFlag ? ` · ${nFlag} with open findings` : ''}</div></div></div></td>
                <td /><td />
                <td className="tf-amt w6">{t ? money2(num(t[1])) : '—'}</td>
                <td className="tf-amt w6">{t ? money2(num(t[2])) : '—'}</td>
                <td className="tf-amt w6">{t ? money2(num(t[3])) : '—'}</td>
                <Amt v={x.total?.value} lineKey={x.total?.key} fmt={money2} eff={eff} />
                <FlagCell lineKeys={x.lots.map((y) => y.l.key)} />
              </tr>
              {isOpen && lots.map((y) => <LotRow key={y.l.key} x={y} />)}
            </Fragment>
          );
        })}
        <tr className="last">
          <td className="tf-ln">Σ</td><td><Label main="All boxes" /></td><td /><td />
          <td className="tf-amt">{money2(boxes.reduce((s, x) => s + num(x.total?.label.match(TOTALS)?.[1] ?? 0), 0))}</td>
          <td className="tf-amt">{money2(boxes.reduce((s, x) => s + num(x.total?.label.match(TOTALS)?.[2] ?? 0), 0))}</td>
          <td className="tf-amt">{money2(boxes.reduce((s, x) => s + num(x.total?.label.match(TOTALS)?.[3] ?? 0), 0))}</td>
          <td className="tf-amt">{money2(boxes.reduce((s, x) => s + (x.total ? gainOf(x.total) : 0), 0))}</td><td />
        </tr>
      </Sheet>
      <div className="ties card"><div className="card-h"><div className="h3">Ties to the return</div></div>
        {boxes.map((x) => {
          const s = round(x.lots.reduce((n, y) => n + y.l.value, 0));
          return x.total && <Tie key={x.b} ok={Math.abs(s - x.total.value) <= 1}>Box {x.b}: {x.lots.length} lots add up to {money2(s)}; box total {money2(x.total.value)}</Tie>;
        })}
      </div>
    </>
  );
}

// ── State split ─────────────────────────────────────────────────────────────

function StateSplit() {
  const { state } = useWorkpaper();
  const eff = new Map(state.return.lines.map((l) => [l.key, l]));
  const rows = new Map();
  for (const l of linesOf().filter((x) => x.form === 'SchCA540NR')) {
    const [n, col] = l.line.split('.');
    if (!['A', 'B', 'C', 'D', 'E'].includes(col)) continue;
    if (!rows.has(n)) rows.set(n, { n, label: l.label.replace(/ - (federal|CA additions|CA subtractions|total using CA law|California amount)$/i, '').replace(/ using CA law$/, ''), cols: {} });
    rows.get(n).cols[col] = l;
  }
  const cols = [{ h: 'Line', w: 64 }, { h: 'Income', left: true }, { h: 'A · Federal', w: 128 }, { h: 'B · Subtract', w: 116 }, { h: 'C · Add', w: 108 }, { h: 'D · CA law', w: 128 }, { h: 'E · California', w: 132 }, { h: 'CA share', w: 92 }, { h: '', w: 90 }];
  const ratio = ['F540NR.17', 'F540NR.18', 'F540NR.19', 'F540NR.31', 'F540NR.32', 'F540NR.34', 'F540NR.35', 'F540NR.36', 'F540NR.37', 'F540NR.39', 'F540NR.40', 'F540NR.64'];
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  return (
    <>
      <div className="res-strip mb16">
        {raw.household.residency.map((r) => (
          <div key={r.state} className="res">
            <span className={`res-dot ${r.state === 'CA' ? 'ca' : ''}`}>{r.state}</span>
            <div><div className="w6">{r.state === 'CA' ? 'California' : r.state === 'TX' ? 'Texas' : r.state} {r.status}</div><div className="t12 c3">{fmtDate(r.from)} to {fmtDate(r.to)}</div></div>
          </div>
        ))}
        <div className="t12 c3" style={{ maxWidth: 420 }}>California taxes all income while resident, and only California-source income after the move. Column E is the California amount; the tax rate comes from total income.</div>
      </div>
      <Sheet prefix="Schedule" code="CA" title="California adjustments, nonresident or part-year (540NR)" sub="Each amount opens its line and evidence" cols={cols}>
        {[...rows.values()].map((r) => {
          const d = r.cols.D?.value; const e = r.cols.E?.value;
          const isTot = /^total/i.test(r.label);
          return (
            <tr key={r.n} className={isTot ? 'last' : ''}>
              <td className="tf-ln">{r.n}</td>
              <td><Label main={r.label} /></td>
              {['A', 'B', 'C', 'D', 'E'].map((c) => (r.cols[c] ? <Amt key={c} v={r.cols[c].value} lineKey={r.cols[c].key} eff={eff} /> : <td key={c} className="tf-amt c4">—</td>))}
              <td className="tf-amt c2">{typeof d === 'number' && typeof e === 'number' && d > 0 && e >= 0 ? `${Math.round((e / d) * 100)}%` : '—'}</td>
              <FlagCell lineKeys={Object.values(r.cols).map((l) => l.key)} />
            </tr>
          );
        })}
      </Sheet>
      <Sheet prefix="Form" code="540NR" title="California tax on a part-year basis" sub="Tax on all income at California rates, prorated to the California share" cols={[{ h: 'Line', w: 64 }, { h: 'Description', left: true }, { h: 'Amount', w: 160 }, { h: '', w: 90 }]}>
        {ratio.map((k) => {
          const l = line(k);
          if (!l) return null;
          const isRate = /percentage|tax rate/i.test(l.label);
          return (
            <tr key={k} className={k === 'F540NR.64' ? 'last' : ''}>
              <td className="tf-ln">{l.line}</td>
              <td><div className="tf-label"><span>{l.label}</span><i /></div></td>
              <Amt v={l.value} lineKey={k} fmt={isRate ? pct : money} eff={eff} />
              <FlagCell lineKeys={[k]} />
            </tr>
          );
        })}
      </Sheet>
      <div className="ties card"><div className="card-h"><div className="h3">Ties to the return</div></div>
        {(() => {
          const r17 = line('F540NR.17').value; const r32 = line('F540NR.32').value; const r34 = line('F540NR.34').value;
          const ok34 = Math.abs(r32 / r17 - r34) < 0.0001;
          const d22 = line('SchCA540NR.22.D').value; const sumD = [...rows.values()].filter((r) => !/^total/i.test(r.label) && r.n !== '26').reduce((s, r) => s + (r.cols.D?.value ?? 0), 0);
          return [
            <Tie key="r" ok={ok34}>Deduction percentage {pct(r34)} = California AGI {money(r32)} ÷ total AGI {money(r17)}</Tie>,
            <Tie key="d" ok={Math.abs(sumD - d22) <= 1}>Income lines in column D add up to {money(sumD)}; line 22 shows {money(d22)}</Tie>,
          ];
        })()}
      </div>
    </>
  );
}

// ── Books to tax ────────────────────────────────────────────────────────────

const BOOKS_DOC = 'D14';
const MONEYLINE = (l) => typeof l.value === 'number' && !/^4[3-4]|^[IJ]$/.test(l.line);

function Books() {
  const { openTrace } = useWorkpaper();
  const book = packet.observations.filter((o) => o.doc_id === BOOKS_DOC && typeof o.value === 'number');
  const bookById = new Map(book.map((o) => [o.id, o]));
  const totals = Object.fromEntries(book.filter((o) => /^(total_income|total_expenses|net_income)$/.test(o.field)).map((o) => [o.field, o]));
  const accounts = book.filter((o) => !totals[o.field] || totals[o.field] !== o);
  const sc = linesOf().filter((l) => l.form === 'SchC' && MONEYLINE(l));
  const rulesText = raw.engine_reference.rules;
  const isIncome = (l) => l.line === '1';
  const isExpense = (l) => !['1', '5', '7', '28', '29', '31'].includes(l.line);
  const used = new Set();
  const rows = sc.filter((l) => isIncome(l) || isExpense(l)).map((l) => {
    const src = l.sources.filter((s) => bookById.has(s));
    src.forEach((s) => used.add(s));
    const bookAmt = src.filter((s) => !/total_income/.test(bookById.get(s).field) || isIncome(l)).reduce((n, s) => n + bookById.get(s).value, 0);
    const income = isIncome(l);
    const adj = income ? l.value - bookAmt : -(l.value - bookAmt);
    return { l, src, bookAmt, adj, income, why: l.note ?? (adj ? rulesText[l.rule] : '') };
  });
  const words = (t) => String(t).toLowerCase().match(/[a-z]{5,}/g) ?? [];
  const removed = accounts.filter((o) => !used.has(o.id) && !['total_income', 'total_expenses', 'net_income'].includes(o.field) && !/^(sales|revenue|income)/i.test(o.label)).map((o) => {
    const direct = landingsOfObs(o.id).filter((l) => l.form !== 'SchC');
    const same = linesOf().find((l) => l.form !== 'SchC' && l.value === o.value && words(o.label).some((w) => words(l.label).includes(w)));
    const elsewhere = direct.length ? direct : same ? [same] : [];
    const replacedBy = sc.find((l) => (l.note ?? '').toLowerCase().includes(o.label.toLowerCase()) || (l.note ?? '').includes(money2(o.value).slice(1)));
    const why = elsewhere.length ? `Moved to ${elsewhere.map((l) => `${l.key} · ${l.label}`).join(', ')}` : replacedBy ? `Replaced by Schedule C line ${replacedBy.line}` : 'Not deductible on Schedule C';
    return { o, adj: o.value, why, go: elsewhere[0]?.key ?? replacedBy?.key };
  });
  const net = totals.net_income?.value ?? 0;
  const totalAdj = rows.reduce((s, r) => s + r.adj, 0) + removed.reduce((s, r) => s + r.adj, 0);
  const sc31 = line('SchC.31');
  const cols = [{ h: 'Line', w: 64 }, { h: 'Schedule C line', left: true }, { h: 'Books (D14)', w: 130 }, { h: 'Tax', w: 130 }, { h: 'Book to tax', w: 130 }, { h: 'Why', left: true, w: '32%' }];
  return (
    <>
      <Sheet prefix="Schedule" code="M-1" title="Books to taxable income · Lindqvist Studio" sub="QuickBooks profit and loss (D14, cash basis) to Schedule C. A positive adjustment raises taxable profit." cols={cols}>
        <tr className="sch-box">
          <td className="tf-ln">—</td><td><Label main="Net income per books" sub="D14 page 1" /></td>
          <td className="tf-amt w6"><button type="button" className="amt-link" onClick={() => openTrace({ ref: totals.net_income?.id })}>{money(net)}</button></td><td /><td /><td />
        </tr>
        <Part span={cols.length}>Mapped to Schedule C</Part>
        {rows.map((r) => (
          <tr key={r.l.key} className="click" onClick={() => navigate('return', { line: r.l.key })}>
            <td className="tf-ln">{r.l.line}</td>
            <td><Label main={r.l.label} sub={r.src.length ? r.src.map((s) => bookById.get(s).label).join(' + ') : 'Not in the books'} /></td>
            <td className="tf-amt c2">{r.src.length ? money(r.bookAmt) : '—'}</td>
            <td className="tf-amt">{money(r.l.value)}</td>
            <td className={`tf-amt ${r.adj ? 'w6' : 'c4'}`}>{r.adj ? signed(r.adj) : '—'}</td>
            <td><div className="sch-why" title={r.why}>{r.adj ? r.why : ''}</div></td>
          </tr>
        ))}
        <Part span={cols.length}>In the books, not deducted on Schedule C</Part>
        {removed.map((r) => (
          <tr key={r.o.id} className="click" onClick={() => (r.go ? navigate('return', { line: r.go }) : openTrace({ ref: r.o.id }))}>
            <td className="tf-ln">—</td>
            <td><Label main={r.o.label} sub={r.o.id} mono /></td>
            <td className="tf-amt c2">{money(r.o.value)}</td>
            <td className="tf-amt c4">—</td>
            <td className="tf-amt w6">{signed(r.adj)}</td>
            <td><div className="sch-why">{r.why}</div></td>
          </tr>
        ))}
        <tr className="last">
          <td className="tf-ln">31</td><td><Label main="Net profit, Schedule C" sub={`Books ${money(net)} ${totalAdj < 0 ? '−' : '+'} adjustments ${money(Math.abs(totalAdj))}`} /></td>
          <td className="tf-amt">{money(net)}</td>
          <Amt v={sc31.value} lineKey="SchC.31" />
          <td className="tf-amt">{signed(totalAdj)}</td><td />
        </tr>
      </Sheet>
      <div className="ties card"><div className="card-h"><div className="h3">Ties to the return</div></div>
        <Tie ok={Math.abs(net + totalAdj - sc31.value) <= 1}>Books {money(net)} plus adjustments {signed(totalAdj)} = {money(net + totalAdj)}; Schedule C line 31 is {money(sc31.value)}</Tie>
        {totals.total_expenses && <Tie ok={Math.abs(accounts.filter((o) => !['total_income', 'total_expenses', 'net_income'].includes(o.field) && !/^Sales/.test(o.label)).reduce((s, o) => s + o.value, 0) - totals.total_expenses.value) <= 1}>Book expense accounts add up to the books' total expenses of {money(totals.total_expenses.value)}</Tie>}
      </div>
    </>
  );
}

// ── Rentals and passive ─────────────────────────────────────────────────────

function Rentals() {
  const { state } = useWorkpaper();
  const eff = new Map(state.return.lines.map((l) => [l.key, l]));
  const se = linesOf().filter((l) => l.form === 'SchE');
  const byProp = new Map();
  for (const l of se) {
    const m = l.line.match(/^(\d+)([AB])$/);
    if (!m || Number(m[1]) > 22) continue;
    if (!byProp.has(m[1])) byProp.set(m[1], { n: m[1], label: l.label.replace(/ - property [AB]$/, ''), A: null, B: null });
    byProp.get(m[1])[m[2]] = l;
  }
  const ordered = [...byProp.values()].filter((r) => r.n !== '1').sort((a, b) => Number(a.n) - Number(b.n));
  const pa = line('SchE.1A')?.value; const pb = line('SchE.1B')?.value;
  const cy = raw.prior_years.carryovers_into_2025;
  const cols = [{ h: 'Line', w: 64 }, { h: 'Item', left: true }, { h: 'A · Fremont Way', w: 170 }, { h: 'B · Barton Hills', w: 170 }, { h: '', w: 90 }];
  const cell = (l) => (l ? (typeof l.value === 'number' ? <Amt v={l.value} lineKey={l.key} eff={eff} /> : <td className="tf-amt c2">{l.value}</td>) : <td className="tf-amt c4">—</td>);
  return (
    <>
      <Sheet prefix="Schedule" code="E" title="Rental real estate, by property" sub={`A · ${pa} · B · ${pb}`} cols={cols}>
        {ordered.map((r) => (
          <tr key={r.n} className={['20', '21', '22'].includes(r.n) ? 'last' : ''}>
            <td className="tf-ln">{r.n}</td>
            <td><div className="tf-label"><span>{r.label}</span><i /></div></td>
            {cell(r.A)}{cell(r.B)}
            <FlagCell lineKeys={[r.A?.key, r.B?.key].filter(Boolean)} />
          </tr>
        ))}
        <tr>
          <td className="tf-ln">—</td><td><div className="tf-label"><span>Suspended passive loss brought into 2025</span><i /></div></td>
          <Amt v={cy.passive_1450_fremont} refId="py:/carryovers_into_2025/passive_1450_fremont" />
          <Amt v={cy.passive_1200_barton_hills} refId="py:/carryovers_into_2025/passive_1200_barton_hills" /><td />
        </tr>
      </Sheet>
      <Sheet prefix="Form" code="8582" title="Passive activity loss limitation" sub="Rental losses are allowed against passive income: K-1 income and the gain on the Austin condo, which also frees its suspended losses" cols={[{ h: 'Line', w: 64 }, { h: 'Description', left: true }, { h: 'Amount', w: 170 }, { h: '', w: 90 }]}>
        {[...linesOf().filter((l) => l.form === 'F8582'), ...['SchE.28A', 'SchE.28B', 'SchE.32', 'SchE.26', 'SchE.41'].map((k) => line(k))].filter(Boolean).map((l) => (
          <tr key={l.key} className={['F8582.4', 'SchE.41'].includes(l.key) ? 'last' : ''}>
            <td className="tf-ln t12">{l.form === 'SchE' ? `E ${l.line}` : l.line}</td>
            <td><div className="tf-label"><span>{l.label}</span><i /></div></td>
            <Amt v={l.value} lineKey={l.key} eff={eff} />
            <FlagCell lineKeys={[l.key]} />
          </tr>
        ))}
      </Sheet>
      <div className="ties card"><div className="card-h"><div className="h3">Ties to the return</div></div>
        {['A', 'B'].map((p) => {
          const rent = line(`SchE.3${p}`).value; const exp = line(`SchE.20${p}`).value; const net = line(`SchE.21${p}`).value;
          return <Tie key={p} ok={rent - exp === net}>Property {p}: rents {money(rent)} − expenses {money(exp)} = {money(net)}</Tie>;
        })}
        <Tie ok={v3.carryovers_out.federal.passive_1450_fremont === 0 && v3.carryovers_out.federal.passive_1200_barton_hills === 0}>Suspended passive losses carried out of 2025: {money(v3.carryovers_out.federal.passive_1450_fremont + v3.carryovers_out.federal.passive_1200_barton_hills)}</Tie>
      </div>
    </>
  );
}

// ── K-1 ─────────────────────────────────────────────────────────────────────

function K1s() {
  const { openTrace } = useWorkpaper();
  const docs = packet.documents.filter((d) => /^K-1/.test(d.document_type));
  const py = raw.prior_years.return_2024;
  const prior = (d, field) => {
    const k = d.document_type === 'K-1-1120S' ? py.K1_1120S : d.document_type === 'K-1-1065' ? py.K1_1065 : null;
    if (!k || Number(d.tax_year) !== 2025) return undefined;
    const hit = Object.entries(k).find(([key]) => key.toLowerCase() === field.toLowerCase());
    return hit?.[1];
  };
  const fmt = (o) => (o.value_type === 'percent' || (typeof o.value === 'number' && o.value > 0 && o.value < 1) ? `${Math.round(o.value * 100)}%` : typeof o.value === 'number' ? money2(o.value) : String(o.value));
  return docs.map((d) => {
    const obs = packet.observations.filter((o) => o.doc_id === d.id);
    const is2025 = Number(d.tax_year) === 2025;
    return (
      <Sheet key={d.id} year={d.tax_year} prefix={d.id} code="K-1" title={d.title} sub={is2025 ? `${d.issuer} · received ${fmtDate(d.received_at)}` : `${d.issuer} · prior year: supports the basis roll-forward`} cols={[{ h: 'Box', left: true, w: 120 }, { h: 'Description', left: true }, { h: `${d.tax_year}`, w: 140 }, { h: '2024 return', w: 130 }, { h: 'Landed on', left: true, w: 260 }]}>
        {obs.map((o) => {
          const lands = landingsOfObs(o.id);
          const before = prior(d, o.field);
          return (
            <tr key={o.id} className="click" onClick={() => openTrace({ ref: o.id })}>
              <td><Label main={o.field} sub={o.id} mono /></td>
              <td><Label main={o.label} /></td>
              <td className="tf-amt w6">{fmt(o)}</td>
              <td className="tf-amt c3">{typeof before === 'number' ? money(before) : '—'}</td>
              <td>
                <div className="sch-label row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {lands.length ? lands.slice(0, 3).map((l) => <button type="button" key={l.key} className="pill outline mono" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); navigate('return', { line: l.key }); }}>{l.key}</button>)
                    : <span className="t12 c3">{is2025 ? 'Informational' : 'Basis history'}</span>}
                  {lands.length > 3 && <span className="t12 c3">+{lands.length - 3}</span>}
                </div>
              </td>
            </tr>
          );
        })}
      </Sheet>
    );
  });
}

// ── Carryovers ──────────────────────────────────────────────────────────────

function Carryovers() {
  const { openTrace } = useWorkpaper();
  const cin = raw.prior_years.carryovers_into_2025;
  const out = v3.carryovers_out;
  const fedKeys = [...new Set([...Object.keys(cin).filter((k) => typeof cin[k] === 'number'), ...Object.keys(out.federal).filter((k) => typeof out.federal[k] === 'number')])];
  const caIn = cin.california ?? {};
  const caKeys = [...new Set([...Object.keys(caIn).filter((k) => typeof caIn[k] === 'number'), ...Object.keys(out.california).filter((k) => typeof out.california[k] === 'number')])];
  const cols = [{ h: 'Carryover', left: true }, { h: 'Into 2025', w: 140 }, { h: 'Out of 2025', w: 140 }, { h: 'Change', w: 130 }, { h: 'Note', left: true, w: '30%' }];
  const Rows = ({ keys, a, b, prefix }) => keys.map((k) => {
    const i = a[k]; const o = b[k];
    const d = (o ?? 0) - (i ?? 0);
    const note = i && o === 0 ? 'Used in full in 2025' : !i && o ? 'New in 2025' : '';
    return (
      <tr key={k}>
        <td><Label main={humanize(k)} sub={`${prefix}${k}`} mono /></td>
        {i !== undefined ? <Amt v={i} refId={`py:/carryovers_into_2025/${prefix ? 'california/' : ''}${k}`} /> : <td className="tf-amt c4">—</td>}
        <td className="tf-amt">{o !== undefined ? money(o) : '—'}</td>
        <td className={`tf-amt ${d ? 'w6' : 'c4'}`}>{d ? signed(d) : '—'}</td>
        <td><div className="sch-why">{note}</div></td>
      </tr>
    );
  });
  const depr = out.california.depreciation_basis_differences ?? {};
  return (
    <>
      <Sheet prefix="Schedule" code="CO" title="Carryovers into and out of 2025" sub={`Into 2025: ${cin.sources}. Out of 2025: engine v3.`} cols={cols}>
        <Part span={5}>Federal</Part>
        <Rows keys={fedKeys} a={cin} b={out.federal} prefix="" />
        <Part span={5}>California</Part>
        <Rows keys={caKeys} a={caIn} b={out.california} prefix="california." />
        {Object.keys(depr).length > 0 && <Part span={5}>California depreciation basis differences carried forward</Part>}
        {Object.entries(depr).map(([id, v]) => (
          <tr key={id} className="click" onClick={() => openTrace({ ref: `asset:${id}` })}>
            <td><Label main={v3.assets.find((a) => a.asset_id === id)?.description ?? id} sub={id} mono /></td>
            <td className="tf-amt c4">—</td><td className="tf-amt">{money2(v)}</td><td className="tf-amt c4">—</td>
            <td><div className="sch-why">California allowed less depreciation than federal</div></td>
          </tr>
        ))}
      </Sheet>
      {caIn.note && <div className="t13 c2 mb24" style={{ maxWidth: 820 }}>{caIn.note}</div>}
    </>
  );
}

// ── Basis ───────────────────────────────────────────────────────────────────

const BASIS = {
  scorp_lindqvist_family_woodworks: { name: 'Lindqvist Family Woodworks, Inc. · S corporation stock basis', end: 'ending_stock_basis', lines: ['F7203.1', 'F7203.4', 'F7203.6', 'F7203.15', 'F7203.excess'], carry: 'scorp_stock_basis_end' },
  partnership_ridgeline: { name: 'Ridgeline Real Estate Fund III LP · capital account and outside basis', end: 'ending_capital_account', carry: 'ridgeline_capital_account_end' },
  ira_nondeductible_basis_ngozi: { name: 'Ngozi · nondeductible IRA basis (Form 8606)', end: 'form_8606_line_14', carry: 'ira_nondeductible_basis_ngozi', lines: ['F8606.1', 'F8606.2', 'F8606.3', 'F8606.14'] },
  home_7709_barton_ridge: { name: '7709 Barton Ridge · main home basis', end: 'price' },
};

function Basis() {
  const { state } = useWorkpaper();
  const eff = new Map(state.return.lines.map((l) => [l.key, l]));
  return Object.entries(raw.prior_years.basis_records).map(([k, recs]) => {
    const m = BASIS[k] ?? { name: humanize(k), end: '' };
    const lines = (m.lines ?? []).map((x) => line(x)).filter(Boolean);
    const carry = m.carry ? v3.carryovers_out.federal[m.carry] : undefined;
    return (
      <Sheet key={k} prefix="Basis" code={k === 'ira_nondeductible_basis_ngozi' ? '8606' : k.startsWith('scorp') ? '7203' : k.startsWith('home') ? 'HOME' : 'K-1'} title={m.name} sub="Prior years from the prior preparer's file; 2025 from engine v3" cols={[{ h: 'Year', w: 110, left: true }, { h: 'What', left: true }, { h: 'Amount', w: 150 }, { h: 'Source', left: true, w: '34%' }, { h: '', w: 90 }]}>
        {recs.map((r, i) => {
          const val = r[m.end];
          const extra = Object.entries(r).filter(([f]) => !['year', 'source', 'event', m.end].includes(f));
          const missing = val === null;
          return (
            <tr key={i}>
              <td style={{ paddingLeft: 14 }} className="w6">{r.year ?? r.event?.split(' ').at(-1)}</td>
              <td><Label main={humanize(m.end)} sub={extra.map(([f, v]) => `${humanize(f)} ${typeof v === 'number' ? money(v) : v ?? '—'}`).join(' · ') || r.event} /></td>
              <td className={`tf-amt ${missing ? 'amber w6' : ''}`}>{missing ? 'Missing' : money(val)}</td>
              <td><div className="sch-why">{r.source}</div></td><td />
            </tr>
          );
        })}
        {lines.length > 0 && <Part span={5}>2025 roll-forward</Part>}
        {lines.map((l) => (
          <tr key={l.key}>
            <td style={{ paddingLeft: 14 }} className="mono t12 c3">{l.key}</td>
            <td><div className="tf-label"><span>{l.label}</span><i /></div></td>
            <Amt v={l.value} lineKey={l.key} eff={eff} />
            <td />
            <FlagCell lineKeys={[l.key]} />
          </tr>
        ))}
        {carry !== undefined && (
          <tr className="last">
            <td style={{ paddingLeft: 14 }}>2025 end</td><td><Label main="Carried into 2026" sub={`carryovers_out.${m.carry}`} mono /></td>
            <td className="tf-amt">{money(carry)}</td><td /><td />
          </tr>
        )}
      </Sheet>
    );
  });
}

// ── Prior preparer vs us ────────────────────────────────────────────────────

// Prior preparer's open items → the check (by result id) or return line that now covers each one.
const PRIOR_LINKS = [
  [/woodworks/i, /^$/, 'F7203.1', 'Basis rolled forward on Form 7203 using the 2023 K-1 now in the packet (D40)'],
  [/5498|ira basis/i, /qa-31|F8606\.14/],
  [/home office/i, /HOME_OFFICE/],
  [/3520/i, /form_3520/],
];

function Prior() {
  const { state, openTrace } = useWorkpaper();
  const ppw = raw.prior_years.prior_preparer_workpaper;
  const ours = state.items.filter((i) => i.closing && ['correct', 'decide', 'dismiss', 'adjust'].includes(i.closing.kind));
  const open = state.items.filter((i) => ['error', 'conflict', 'judgment'].includes(i.kind) && !i.closing);
  return (
    <div className="prior-grid">
      <div className="card">
        <div className="card-h"><div><div className="h3">What the prior preparer did</div><div className="t12 c3">2024 workpaper ({ppw.source_document}) · {raw.prior_years.return_2024.prepared_by}</div></div>
          <button type="button" className="btn sm" onClick={() => openTrace({ ref: ppw.source_document })}>Open {ppw.source_document}</button></div>
        <div style={{ padding: '16px 20px' }}>
          <div className="cap mb8">Summary memo</div>
          <p className="t13 c2" style={{ margin: '0 0 16px' }}>{ppw.summary_memo}</p>
          <div className="cap mb8">Notes</div>
          <ul className="sch-list">{ppw.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <div className="cap mb8 mt16">Left open</div>
          <ul className="sch-list amber-list">{ppw.open_items_left_by_prior_preparer.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><div><div className="h3">What this year's review changed</div><div className="t12 c3">Recorded corrections and decisions, with who and the tax effect</div></div><span className="pill outline">{ours.length} recorded · {open.length} open</span></div>
        {ours.length === 0 ? <div className="empty" style={{ padding: 24 }}>Nothing recorded yet. Corrections and decisions appear here as they are made, next to the {open.length} findings still open.</div> : (
          <table className="tbl" style={{ tableLayout: 'fixed' }}>
            <thead><tr><th>Finding</th><th style={{ width: 150 }}>Recorded</th><th className="r" style={{ width: 110 }}>Federal</th><th className="r" style={{ width: 110 }}>California</th></tr></thead>
            <tbody>
              {ours.map((i) => (
                <tr key={i.id} className="click" onClick={() => navigate('finding', { id: i.id })}>
                  <td><div className="w5 ellipsis" title={i.title}>{i.title}</div><div className="t12 c3 ellipsis">{ACTION_WORDS[i.closing.kind] ?? i.closing.kind}{i.closing.payload?.rationale ? ` · ${i.closing.payload.rationale}` : i.closing.payload?.note ? ` · ${i.closing.payload.note}` : ''}</div></td>
                  <td><div className="t13">{actorById.get(i.closing.actor)?.name ?? i.closing.actor}</div><div className="t12 c3">{fmtDate(i.closing.at)}</div></td>
                  <td className="r num">{signed(i.effect?.federal ?? 0)}</td>
                  <td className="r num">{signed(i.effect?.california ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ padding: '12px 20px 18px' }}>
          <div className="cap mb8 mt8">Where each item the prior preparer left open stands now</div>
          <ul className="sch-list">
            {ppw.open_items_left_by_prior_preparer.map((n) => {
              const rule = PRIOR_LINKS.find(([re]) => re.test(n));
              const hit = rule && state.items.find((i) => rule[1].test(i.id));
              return (
                <li key={n}>
                  <div className="c3 t12">{n}</div>
                  {hit ? <button type="button" className="linkish" onClick={() => navigate('finding', { id: hit.id })}>{hit.title}</button>
                    : rule?.[2] ? <button type="button" className="linkish" onClick={() => navigate('return', { line: rule[2] })}>{rule[3]}</button>
                      : <span className="c3">No check covers this yet</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

const BODY = { depreciation: Depreciation, sales: Sales, state: StateSplit, books: Books, rentals: Rentals, k1: K1s, carry: Carryovers, basis: Basis, prior: Prior };

export function Schedules({ params }) {
  const tab = BODY[params.tab] ? params.tab : 'depreciation';
  const Body = BODY[tab];
  const [, title, sub] = TABS.find(([k]) => k === tab);
  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Schedules', ['schedules']], [title]]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <h1 className="h1">Schedules</h1>
              <div className="sub">The supporting workpapers a CPA expects, built from the packet and engine v3. Every amount opens its line or source, and each schedule shows whether it ties to the return.</div>
            </div>
          </div>
          <div className="sch-tabs mb24">
            {TABS.map(([k, l, s2]) => (
              <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => navigate('schedules', { tab: k })} title={s2}>{l}</button>
            ))}
          </div>
          <div className="cap mb8" style={{ color: 'var(--primary)' }}>{sub}</div>
          <Body />
        </div>
      </div>
    </>
  );
}
