// Carry everything forward with its history, and plan 2026.

import { ArrowRightCircle, CalendarDays, Repeat2, FolderInput } from 'lucide-react';
import { useWorkpaper } from '../state/Workpaper.jsx';
import { packet, actorById } from '../state/base.js';
import { money, money2, fmtDate, ACTION_WORDS } from '../format.js';
import { Crumbs } from '../components/ui.jsx';
import { Header } from '../components/Shell.jsx';
import { navigate } from '../state/router.js';

const raw = packet.raw;
const v3 = raw.return_versions.find((v) => v.version === 'v3');
const plan = raw.planning_reference_2026;
const humanize = (k) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function NextYear() {
  const { state, dispatch, actor } = useWorkpaper();
  const fedTax = state.return.effective.federal.total_tax;
  const caTax = state.return.effective.california.total_tax;
  const fedPlan = Math.ceil((fedTax * 1.1) / 4);
  const caTotal = Math.round(caTax * 1.1);
  const carry = Object.entries(v3.carryovers_out.federal).filter(([, v]) => typeof v === 'number' && v);
  const caCarry = Object.entries(v3.carryovers_out.california.depreciation_basis_differences ?? {});
  const assets = v3.assets.filter((a) => !a.disposed);
  const recurring = state.items.filter((i) => i.closing && ['decide'].includes(i.closing.kind) && ['judgment', 'conflict'].includes(i.kind));
  const outside = state.items.filter((i) => i.kind === 'outside_filing');
  const ppOpen = raw.prior_years.prior_preparer_workpaper.open_items_left_by_prior_preparer;
  const canRoll = ['preparer', 'reviewer', 'partner'].includes(actor?.role);

  return (
    <>
      <Header><Crumbs items={[['Okafor-Lindqvist', ['overview']], ['Next year']]} /></Header>
      <div className="content">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="page-head">
            <div>
              <h1 className="h1">Next year</h1>
              <div className="sub">What the 2026 file starts from: carryovers, assets, decisions that recur, obligations outside the return, and the estimated tax plan. Each opening balance links back to where it was decided in 2025.</div>
            </div>
            {state.rolledForward ? <span className="pill green">Rolled forward {fmtDate(state.rolledForward.at)} by {actorById.get(state.rolledForward.actor)?.name}</span>
              : <button type="button" className="btn primary" disabled={!state.filed || !canRoll} title={!state.filed ? 'Roll forward after filing' : ''} onClick={() => dispatch({ kind: 'roll_forward', target: 'return', payload: { carryovers: v3.carryovers_out, assets: assets.map((a) => a.asset_id), decisions: recurring.map((i) => i.id), outside: outside.map((i) => i.id) } }, { label: '2026 file opened with these balances' })}><FolderInput size={15} /> Start the 2026 file</button>}
          </div>

          <div className="grid-2 mb24">
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><CalendarDays size={16} /></span><div><div className="h3">2026 federal estimates</div><div className="t12 c3">{plan.federal_safe_harbor}</div></div></div></div>
              <table className="tbl"><thead><tr><th>Due</th><th className="r">Installment</th></tr></thead>
                <tbody>{plan.federal_estimate_due_dates.map((d) => <tr key={d}><td>{fmtDate(d)}</td><td className="r num w6">{money(fedPlan)}</td></tr>)}
                  <tr><td className="c3">110% of 2025 total tax {money(fedTax)}</td><td className="r num w6">{money(fedPlan * 4)}</td></tr></tbody></table>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><CalendarDays size={16} /></span><div><div className="h3">2026 California estimates</div><div className="t12 c3">{plan.california_safe_harbor}</div></div></div></div>
              <table className="tbl"><thead><tr><th>Due</th><th className="r">Share</th><th className="r">Installment</th></tr></thead>
                <tbody>{plan.california_estimate_due_dates.map((d, k) => <tr key={d}><td>{fmtDate(d)}</td><td className="r c3">{Math.round(plan.california_installment_percentages[k] * 100)}%</td><td className="r num w6">{money(Math.round(caTotal * plan.california_installment_percentages[k]))}</td></tr>)}
                  <tr><td className="c3" colSpan={2}>110% of 2025 California tax {money(caTax)}. Likely far less is needed: no California residency in 2026.</td><td className="r num w6">{money(caTotal)}</td></tr></tbody></table>
            </div>
          </div>

          <div className="card mb24"><div className="card-h"><div className="h3">Known changes for 2026</div></div>
            <ul className="sch-list" style={{ padding: '16px 24px 16px 40px' }}>{plan.known_2026_changes_for_this_household.map((x) => <li key={x}>{x}</li>)}</ul></div>

          <div className="grid-2 mb24">
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-h"><div className="h3">Opening balances carried in</div><button type="button" className="linkish t13" onClick={() => navigate('schedules', { tab: 'carry' })}>Carryover schedule</button></div>
              <table className="tbl"><tbody>
                {carry.map(([k, v]) => <tr key={k}><td>{humanize(k)}</td><td className="r num w6">{money(v)}</td></tr>)}
                {caCarry.map(([k, v]) => <tr key={k}><td>California depreciation basis difference · {k}</td><td className="r num w6">{money2(v)}</td></tr>)}
              </tbody></table>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-h"><div className="h3">Assets still in service</div><button type="button" className="linkish t13" onClick={() => navigate('schedules', { tab: 'depreciation' })}>Depreciation schedule</button></div>
              <table className="tbl" style={{ tableLayout: 'fixed' }}><thead><tr><th>Asset</th><th className="r" style={{ width: 130 }}>Federal left</th><th className="r" style={{ width: 130 }}>California left</th></tr></thead><tbody>
                {assets.map((a) => <tr key={a.asset_id}><td><div className="w5 ellipsis" title={a.description}>{a.description}</div><div className="t12 c3 ellipsis" title={a.method}>{a.asset_id} · {a.method}</div></td><td className="r num">{money2(a.cost - a.federal.accumulated_end)}</td><td className="r num">{money2(a.cost - a.california.accumulated_end)}</td></tr>)}
              </tbody></table>
            </div>
          </div>

          <div className="grid-2 mb24">
            <div className="card">
              <div className="card-h"><div className="row" style={{ gap: 12 }}><span className="ico"><Repeat2 size={16} /></span><div className="h3">Decisions that carry into 2026</div></div><span className="t12 c3">{recurring.length}</span></div>
              {recurring.length === 0 ? <div className="card-b c3 t13">No judgment calls recorded yet. Elections and treatments decided this year will be listed here so next year starts from them.</div>
                : recurring.map((i) => <div key={i.id} className="lrow click" onClick={() => navigate('finding', { id: i.id })}><div className="grow" style={{ minWidth: 0 }}><div className="w5 ellipsis">{i.title}</div><div className="t12 c3 ellipsis">{i.alternatives[i.closing.payload.alternative]?.label ?? ACTION_WORDS[i.closing.kind]} · {i.closing.payload.authority ?? i.closing.payload.rationale}</div></div><ArrowRightCircle size={16} className="c4" /></div>)}
            </div>
            <div className="card">
              <div className="card-h"><div className="h3">Outside this return</div><span className="t12 c3">{outside.length + ppOpen.length}</span></div>
              {outside.map((i) => <div key={i.id} className="lrow click" onClick={() => navigate('finding', { id: i.id })}><span className={`pill ${i.status === 'closed' ? 'green' : 'amber'}`}>{i.status === 'closed' ? 'Handled' : 'Open'}</span><span className="t13 grow ellipsis">{i.title}</span></div>)}
              <div className="t12 c3" style={{ padding: '10px 24px' }}>Left open by the prior preparer: {ppOpen.length}. See Schedules · Prior preparer vs us.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
