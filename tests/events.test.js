// Acceptance gate for step 4 (events + reducer + effective return + filing gate).

import { describe, it, expect, beforeAll } from 'vitest';
import { loadPacket } from '../src/domain/packet/index.js';
import { matchFacts } from '../src/domain/facts/index.js';
import { runChecks } from '../src/domain/checks/index.js';
import { reduce, makeBase, append, closeWith, recommendedAlternative, changesBetween } from '../src/domain/events/index.js';
import { readPacketText } from './helpers.js';

const PREPARER = 'st-01'; // Priya Raman
const REVIEWER = 'st-02'; // Daniel Ortiz, CPA
const PARTNER = 'st-03'; // Helen Strand, CPA
const NEW_HIRE = 'st-04'; // Marcus Bell, active from 2026-03-24
const QUALITY = 'st-06'; // Sam Adeyemi, active from 2027-01-04
const CLIENT = 'cu-01';

let base;
let checks;
const at = (d) => `2026-${d}T15:00:00Z`;
const item = (state, id) => state.itemsById.get(id);

/** The preparer closes every item: recommendations accepted, except elections (declined). */
function prepareAll(log = [], { exceptIds = [] } = {}) {
  const drafts = [];
  for (const r of checks.results) {
    if (exceptIds.includes(r.id)) continue;
    let alternative = recommendedAlternative(r);
    if (r.check === 'election') alternative = 0;
    if (r.check === 'missing_basis' && alternative === null) alternative = 0;
    drafts.push(closeWith(r, {
      actor: PREPARER, at: at('06-24'), batch: 'prep', alternative,
      rationale: r.recommendation?.rationale ?? 'Per evidence', authority: r.recommendation?.authority,
      reason: r.kind === 'completeness' ? 'Engagement or supporting record; reviewed' : r.title,
    }));
  }
  return append(log, ...drafts);
}

function signAll(log, state) {
  const drafts = [];
  for (const i of state.items) {
    if (!i.closing) continue;
    drafts.push({ kind: 'signoff', actor: REVIEWER, at: at('06-26'), batch: 'review', target: i.id, payload: { level: 'reviewer' } });
    if (i.requiredSignoffs.includes('partner')) drafts.push({ kind: 'signoff', actor: PARTNER, at: at('06-27'), batch: 'partner', target: i.id, payload: { level: 'partner' } });
  }
  return append(log, ...drafts);
}

const MANUAL_STEPS = ['Engagement letter and consents signed', 'Identity verified', 'Prior-year return reviewed', 'Carryovers agreed to prior year', 'Due diligence completed'];

function fullSeason() {
  let log = prepareAll();
  log = signAll(log, reduce(base, log));
  log = append(log, ...MANUAL_STEPS.map((s) => ({ kind: 'complete_step', actor: PREPARER, at: at('06-25'), target: s, payload: { evidence: [] } })));
  log = append(log,
    { kind: 'signoff', actor: REVIEWER, at: at('06-28'), target: 'return', payload: { level: 'reviewer' } },
    { kind: 'signoff', actor: PARTNER, at: at('06-29'), target: 'return', payload: { level: 'partner' } },
    { kind: 'client_approval', actor: CLIENT, at: at('07-10'), target: 'return' });
  return log;
}

beforeAll(() => {
  const packet = loadPacket(JSON.parse(readPacketText()));
  const matched = matchFacts(packet);
  checks = runChecks(packet, matched);
  base = makeBase(packet, matched, checks);
});

describe('no events', () => {
  it('the effective return is the engine return, everything open, filing blocked', () => {
    const s = reduce(base, []);
    expect(s.return.effective.federal).toMatchObject({ total_tax: 81962, payments: 77742, balance_due: 4220 });
    expect(s.return.effective.california).toMatchObject({ total_tax: 18874, payments: 27130, balance_due: -8256 });
    expect(s.items.every((i) => i.status === 'open')).toBe(true);
    expect(s.canFile).toBe(false);
    expect(s.blockers.filter((b) => b.type === 'step').map((b) => b.id)).toEqual(base.requiredSteps);
  });
});

describe('effective return', () => {
  it('correcting the 14 errors moves totals by their summed effect', () => {
    const errors = checks.results.filter((r) => r.kind === 'error');
    const s = reduce(base, append([], ...errors.map((r) => closeWith(r, { actor: PREPARER, at: at('06-24') }))));
    expect(s.return.delta).toEqual({ federal: -16810, california: -8289, federal_payments: 0, california_payments: -3500 });
    const line = (k) => s.return.lines.find((l) => l.key === k);
    expect(line('F8949.B.N1')).toMatchObject({ engine: 19240, effective: 140 });
    expect(line('SchC.1')).toMatchObject({ engine: 163700, effective: 151300 });
    expect(line('SchCA540NR.1.E')).toMatchObject({ engine: 218400, effective: 129569 });
  });

  it('accepting every recommendation lands on the findings tab: federal refund ~4,300, California refund ~11,700', () => {
    const s = reduce(base, prepareAll());
    expect(s.log.filter((l) => l.status === 'rejected')).toEqual([]);
    expect(s.return.delta).toEqual({ federal: -9484, california: -6936, federal_payments: -1000, california_payments: -3500 });
    expect(s.return.effective.federal.balance_due).toBe(-4264);
    expect(s.return.effective.california.balance_due).toBe(-11692);
  });

  it('a decision on its own reproduces the engine\'s what-if exactly; payment changes land on the payment line', () => {
    const r = checks.results.find((x) => x.id === 'repair_or_improvement:SchE.14A:D47');
    const s = reduce(base, append([], closeWith(r, { actor: PREPARER, at: at('06-24'), alternative: recommendedAlternative(r), rationale: 'x', authority: 'y' })));
    const line = (k) => s.return.lines.find((l) => l.key === k);
    const hvacLines = base.packet.raw.what_if.alternatives.find((w) => w.id === 'hvac_improvement').changed_lines;
    for (const c of hvacLines) expect([c.key, line(c.key)?.effective]).toEqual([c.key, c.new]);
    expect(reduce(base, prepareAll()).return.lines.find((l) => l.key === 'F1040.26')).toMatchObject({ engine: 13000, effective: 12000 });
  });

  it('with every change applied, the lines add up and roll to the headline totals', () => {
    for (const log of [prepareAll(), append([], ...checks.results.filter((r) => r.kind === 'error').map((r) => closeWith(r, { actor: PREPARER, at: at('06-24') })))]) {
      const s = reduce(base, log);
      const eff = new Map(s.return.lines.map((l) => [l.key, l.effective]));
      const own = new Map(s.return.lines.map((l) => [l.key, l.own]));
      const v = (k) => eff.get(k) ?? base.lines.get(k).value;
      const { federal: f, california: c } = s.return.effective;
      expect([v('F1040.24'), v('F1040.33'), v('F1040.37')]).toEqual([f.total_tax, f.payments, f.balance_due]);
      expect([v('F540NR.64'), v('F540NR.78'), v('F540NR.97')]).toEqual([c.total_tax, c.payments, -c.balance_due]);
      // every line that is a sum of its inputs still is one, plus any change recorded on the line itself
      for (const [k, signs] of base.graph.signs) {
        if (!signs) continue;
        const sum = base.lines.get(k).inputs.reduce((t, i, n) => t + signs[n] * v(i), 0) + (own.get(k) ?? 0);
        expect([k, Math.abs(sum - v(k)) <= 1.5 ? 0 : sum - v(k)]).toEqual([k, 0]);
      }
    }
  });

  it('a free-form adjustment needs a reason and an effect, and becomes an item to sign off', () => {
    const log = append([],
      { kind: 'adjust', actor: PREPARER, at: at('06-24'), target: 'line:SchC.17', payload: { value: 1500 } },
      { kind: 'adjust', actor: PREPARER, at: at('06-24'), target: 'line:SchC.17', payload: { value: 1500, reason: 'Personal legal fee in books', effect: { federal: 107, california: 9 } } });
    const s = reduce(base, log);
    expect(s.log.map((l) => l.status)).toEqual(['rejected', 'applied']);
    expect(item(s, 'adjustment:e2')).toMatchObject({ status: 'awaiting_signoff', requiredSignoffs: ['reviewer'] });
    expect(s.return.delta.federal).toBe(107);
  });
});

describe('roles and sign-off rules', () => {
  const hvac = 'repair_or_improvement:SchE.14A:D47';
  const decideHvac = (extra = {}) => ({ kind: 'decide', actor: PREPARER, at: at('06-24'), target: hvac,
    payload: { alternative: 1, rationale: 'Whole system replaced', authority: 'Treas. Reg. 1.263(a)-3', ...extra } });

  it('a judgment call without its authority is rejected', () => {
    const s = reduce(base, append([], decideHvac({ authority: undefined })));
    expect(s.log[0]).toMatchObject({ status: 'rejected', reason: 'a judgment call records the authority relied on' });
  });

  it('errors close only by correction; conflicts and judgments only by decision', () => {
    const s = reduce(base, append([], { kind: 'decide', actor: PREPARER, at: at('06-24'), target: 'lot_basis:F8949.B.N1', payload: { alternative: 0, rationale: 'x' } }));
    expect(s.log[0].reason).toBe('error items are closed by correct, not decide');
  });

  it('nobody signs off their own work; preparers cannot sign; partner items need the partner', () => {
    const log = append([], decideHvac(),
      { kind: 'signoff', actor: PREPARER, at: at('06-25'), target: hvac, payload: { level: 'reviewer' } },
      { kind: 'decide', actor: REVIEWER, at: at('06-25'), target: 'se_health_eligibility:Sch1.17', payload: { alternative: 1, rationale: 'qa-25', authority: 'IRC 162(l)(2)(B)' } },
      { kind: 'signoff', actor: REVIEWER, at: at('06-26'), target: 'se_health_eligibility:Sch1.17', payload: { level: 'reviewer' } },
      { kind: 'signoff', actor: REVIEWER, at: at('06-26'), target: hvac, payload: { level: 'reviewer' } });
    const s = reduce(base, log);
    expect(s.log.map((l) => l.reason ?? l.status)).toEqual([
      'applied', 'preparer cannot sign off at reviewer level', 'applied', 'cannot review or sign off work you prepared', 'applied',
    ]);
    expect(item(s, hvac)).toMatchObject({ status: 'awaiting_signoff', requiredSignoffs: ['reviewer', 'partner'] });
  });

  it('staff cannot act before they join the firm', () => {
    const log = append([],
      { kind: 'note', actor: NEW_HIRE, at: at('03-10'), target: 'D23', payload: { text: 'Mileage looks high' } },
      { kind: 'note', actor: QUALITY, at: at('07-01'), target: 'return', payload: { text: 'Selected for review' } });
    expect(reduce(base, log).log.map((l) => l.reason)).toEqual([
      'Marcus Bell is not active until 2026-03-24', 'Sam Adeyemi is not active until 2027-01-04',
    ]);
  });

  it('a sign-off reopens when what was signed changes', () => {
    let log = append([], decideHvac(),
      { kind: 'signoff', actor: REVIEWER, at: at('06-26'), target: hvac, payload: { level: 'reviewer' } },
      { kind: 'signoff', actor: PARTNER, at: at('06-27'), target: hvac, payload: { level: 'partner' } });
    expect(item(reduce(base, log), hvac).status).toBe('closed');
    log = append(log, decideHvac({ alternative: 0, rationale: 'Client says it was only the condenser' }));
    const s = reduce(base, log);
    expect(item(s, hvac)).toMatchObject({ status: 'reopened', stale: ['e2', 'e3'] });
  });
});

describe('undo', () => {
  it('a batch is undone in one step, and the totals return to the engine', () => {
    let log = prepareAll();
    log = append(log, { kind: 'revert', actor: PREPARER, at: at('06-25'), payload: { batch: 'prep' } });
    const s = reduce(base, log);
    expect(s.return.delta).toEqual({ federal: 0, california: 0, federal_payments: 0, california_payments: 0 });
    expect(s.items.every((i) => i.status === 'open')).toBe(true);
  });

  it('undoing the undo restores the batch', () => {
    let log = prepareAll();
    log = append(log, { kind: 'revert', actor: PREPARER, at: at('06-25'), payload: { batch: 'prep' } });
    const undoId = log.at(-1).id;
    log = append(log, { kind: 'revert', actor: PREPARER, at: at('06-25'), target: undoId });
    expect(reduce(base, log).return.delta.federal).toBe(-9484);
  });

  it('only the author, a reviewer or a partner can undo', () => {
    const log = append(prepareAll(), { kind: 'revert', actor: NEW_HIRE, at: at('06-25'), payload: { batch: 'prep' } });
    const s = reduce(base, log);
    expect(s.log.at(-1)).toMatchObject({ status: 'rejected', reason: 'only the author, a reviewer or a partner can undo this' });
    expect(s.return.delta.federal).toBe(-9484);
  });
});

describe('filing gate', () => {
  it('a full season clears every blocker; filing freezes the return', () => {
    let log = fullSeason();
    const before = reduce(base, log);
    expect(before.blockers).toEqual([]);
    expect(before.canFile).toBe(true);
    expect(before.steps.every((x) => x.done)).toBe(true);
    log = append(log, { kind: 'file', actor: REVIEWER, at: at('07-13'), target: 'return' },
      { kind: 'correct', actor: PREPARER, at: at('07-14'), target: 'lot_basis:F8949.B.N1' });
    const s = reduce(base, log);
    expect(s.filed).toMatchObject({ actor: REVIEWER });
    expect(s.filed.return.effective.federal.balance_due).toBe(-4264);
    expect(s.log.at(-1).reason).toBe('the return is filed and frozen; changes go on an amendment');
  });

  it('an open blocking review note blocks filing until resolved', () => {
    let log = append(fullSeason(), { kind: 'note', actor: PARTNER, at: at('07-11'), target: 'SchC.1', payload: { text: 'Tie receipts to deposits', blocking: true } });
    const noteId = log.at(-1).id;
    let s = reduce(base, log);
    expect(s.blockers).toEqual([{ type: 'note', id: noteId, text: 'Tie receipts to deposits' }]);
    log = append(log, { kind: 'file', actor: REVIEWER, at: at('07-12'), target: 'return' });
    expect(reduce(base, log).log.at(-1).status).toBe('rejected');
    log = append(log, { kind: 'resolve_note', actor: PARTNER, at: at('07-12'), target: noteId });
    s = reduce(base, log);
    expect(s.canFile).toBe(true);
  });

  it('the client cannot approve before the partner signs; a later change voids approval and sign-offs', () => {
    let log = append(prepareAll(), { kind: 'client_approval', actor: CLIENT, at: at('06-24'), target: 'return' });
    expect(reduce(base, log).log.at(-1).reason).toBe('the partner has not signed off the current return');
    log = fullSeason();
    log = append(log, { kind: 'decide', actor: PREPARER, at: at('07-11'), target: 'election:equipment_section179',
      payload: { alternative: 1, rationale: 'Saves CA tax', authority: 'IRC 179' } });
    const s = reduce(base, log);
    expect(s.approvals[0].valid).toBe(false);
    expect(s.returnSignoffs.every((r) => !r.valid)).toBe(true);
    expect(s.blockers.map((b) => b.id)).toEqual(expect.arrayContaining(['election:equipment_section179', 'Reviewer sign-off', 'Partner sign-off', 'Client approval and e-file authorization']));
  });

  it('derived steps cannot be ticked by hand', () => {
    const s = reduce(base, append([], { kind: 'complete_step', actor: PREPARER, at: at('06-24'), target: 'All documents accounted for' }));
    expect(s.log[0].reason).toBe('"All documents accounted for" completes itself when its items are closed');
  });
});

describe('history', () => {
  it('reports what changed since a reviewer last looked', () => {
    const log = prepareAll();
    const before = reduce(base, log.slice(0, 0));
    const after = reduce(base, log);
    const d = changesBetween(before, after);
    expect(d.totals).toMatchObject({ 'federal.total_tax': -9484, 'california.payments': -3500 });
    expect(d.lines).toContainEqual({ key: 'F8949.B.N1', from: 19240, to: 140 });
    expect(d.items.find((i) => i.id === 'lot_basis:F8949.B.N1')).toEqual({ id: 'lot_basis:F8949.B.N1', from: 'open', to: 'awaiting_signoff' });
  });

  it('is deterministic and never mutates the log', () => {
    const log = fullSeason();
    const frozen = JSON.stringify(log);
    const a = reduce(base, log);
    const b = reduce(base, [...log].reverse());
    expect(JSON.stringify(log)).toBe(frozen);
    expect(JSON.stringify(a.return)).toBe(JSON.stringify(b.return));
    expect(a.blockers).toEqual(b.blockers);
  });
});

describe('filing and after', () => {
  const fileIt = (log) => append(log, { kind: 'file', actor: REVIEWER, at: at('07-13'), target: 'return' });
  const ack = (j, status, extra = {}) => ({ kind: 'efile_ack', actor: REVIEWER, at: at('07-14'), target: 'return', payload: { jurisdiction: j, status, ...extra } });

  it('an extension is recorded once per jurisdiction, before filing', () => {
    const ext = { kind: 'extend', actor: REVIEWER, at: at('04-14'), target: 'return', payload: { jurisdiction: 'federal', payment: 36000 } };
    const s = reduce(base, append([], ext, ext, { ...ext, actor: PREPARER, payload: { jurisdiction: 'california', payment: 0 } }));
    expect(s.extensions).toHaveLength(1);
    expect(s.log.map((l) => l.reason ?? 'ok')).toEqual(['ok', 'a federal extension is already on file', 'preparer cannot file an extension']);
  });

  it('a rejected e-file unfreezes the return; it is sent again and accepted', () => {
    let log = append(fileIt(fullSeason()), ack('federal', 'rejected', { code: 'R0000-504-02' }));
    let s = reduce(base, log);
    expect(s.filed).toBeNull();
    expect(s.filings[0].rejected.payload.code).toBe('R0000-504-02');
    expect(s.canFile).toBe(true); // nothing in the return changed, so sign-offs and approval still hold
    log = append(fileIt(log), ack('federal', 'accepted'), ack('california', 'accepted'));
    s = reduce(base, log);
    expect(s.filings).toHaveLength(2);
    expect(s.filed.acks.map((a) => a.payload.status)).toEqual(['accepted', 'accepted']);
  });

  it('an amendment reopens the return on top of the filed one, needs fresh sign-off, and files as amended', () => {
    let log = append(fileIt(fullSeason()), ack('federal', 'accepted'));
    log = append(log, { kind: 'correct', actor: PREPARER, at: at('08-01'), target: 'lot_basis:F8949.B.N1' });
    expect(reduce(base, log).log.at(-1).reason).toBe('the return is filed and frozen; changes go on an amendment');
    log = append(log, { kind: 'amend', actor: PARTNER, at: at('08-02'), target: 'return', payload: { reason: 'Exam adjustment' } },
      { kind: 'adjust', actor: PREPARER, at: at('08-03'), target: 'line:SchC.1', payload: { value: 161000, reason: 'Refund to client not income', effect: { federal: -958, california: -84 } } });
    let s = reduce(base, log);
    expect(s.amendment).toMatchObject({ kind: 'amend' });
    expect(s.filed.return.effective.federal.total_tax - s.return.effective.federal.total_tax).toBe(958);
    expect(s.blockers.map((b) => b.id)).toEqual(expect.arrayContaining(['Reviewer sign-off', 'Partner sign-off']));
    const adj = s.items.find((i) => i.kind === 'adjustment');
    log = append(log, { kind: 'signoff', actor: REVIEWER, at: at('08-04'), target: adj.id, payload: { level: 'reviewer' } },
      { kind: 'signoff', actor: REVIEWER, at: at('08-04'), target: 'return', payload: { level: 'reviewer' } },
      { kind: 'signoff', actor: PARTNER, at: at('08-04'), target: 'return', payload: { level: 'partner' } },
      { kind: 'client_approval', actor: CLIENT, at: at('08-05'), target: 'return' },
      { kind: 'file', actor: PARTNER, at: at('08-06'), target: 'return' });
    s = reduce(base, log);
    expect(s.filings.map((f) => f.type)).toEqual(['original', 'amended']);
    expect(s.amendment).toBeNull();
  });

  it('a notice response and the roll-forward need a filed return', () => {
    const resp = { kind: 'notice_response', actor: PREPARER, at: at('09-01'), target: 'N-2025-L566', payload: { text: 'Enclosed' } };
    expect(reduce(base, append([], resp)).log[0].reason).toBe('only a filed return has notices to answer');
    const s = reduce(base, append(fileIt(fullSeason()), resp, { kind: 'roll_forward', actor: PREPARER, at: at('09-02'), target: 'return' }));
    expect(s.noticeResponses[0].filedHash).toBe(s.filed.hash);
    expect(s.rolledForward).not.toBeNull();
  });
});

describe('people and firm', () => {
  it('a question goes to one person; only they (or either client) answer it; a blocking one blocks filing', () => {
    let log = append(fullSeason(), { kind: 'ask', actor: PREPARER, at: at('07-11'), target: 'SchC.1', payload: { to: CLIENT, text: 'Was the $12,400 also deposited?', blocking: true } });
    const q = log.at(-1).id;
    expect(reduce(base, log).blockers).toEqual([{ type: 'question', id: q, text: 'Was the $12,400 also deposited?' }]);
    log = append(log, { kind: 'answer', actor: REVIEWER, at: at('07-11'), target: q, payload: { text: 'n/a' } },
      { kind: 'answer', actor: 'cu-02', at: at('07-12'), target: q, payload: { text: 'Yes, same deposits' } });
    const s = reduce(base, log);
    expect(s.log.at(-2).reason).toBe('only Ngozi Okafor can answer this');
    expect(s.questions[0].answer.payload.text).toBe('Yes, same deposits');
    expect(s.canFile).toBe(true);
  });

  it('assignments go to active preparers, reviewers or partners, set by a reviewer, partner or admin', () => {
    const s = reduce(base, append([],
      { kind: 'assign', actor: 'st-05', at: at('03-25'), target: 'lot_basis:F8949.B.N1', payload: { to: NEW_HIRE, due: '2026-03-27' } },
      { kind: 'assign', actor: PREPARER, at: at('03-25'), target: 'lot_basis:F8949.B.N3', payload: { to: PREPARER } },
      { kind: 'assign', actor: REVIEWER, at: at('03-01'), target: 'lot_basis:F8949.B.N3', payload: { to: NEW_HIRE } }));
    expect(s.log.map((l) => l.reason ?? 'ok')).toEqual(['ok', 'preparer cannot assign work', 'Marcus Bell is not active until 2026-03-24']);
    expect(s.itemsById.get('lot_basis:F8949.B.N1').assignment.payload.to).toBe(NEW_HIRE);
  });

  it('time is logged against the budget areas', () => {
    const s = reduce(base, append([],
      { kind: 'log_time', actor: PREPARER, at: at('03-10'), target: 'return', payload: { area: 'business', hours: 2.5 } },
      { kind: 'log_time', actor: PREPARER, at: at('03-10'), target: 'return', payload: { area: 'golf', hours: 1 } }));
    expect(s.time).toHaveLength(1);
    expect(s.log[1].reason).toMatch(/^area must be one of/);
  });

  it('only the administrator changes standards, and a lower partner threshold pulls more items to the partner', () => {
    const id = 'double_counted:SchA.8a';
    const before = reduce(base, []).itemsById.get(id).requiredSignoffs;
    const s = reduce(base, append([],
      { kind: 'set_standard', actor: PARTNER, at: at('03-01'), target: 'partner_threshold', payload: { value: 100, reason: 'x' } },
      { kind: 'set_standard', actor: 'st-05', at: at('03-01'), target: 'partner_threshold', payload: { value: 100, reason: 'Tighter review this season' } }));
    expect(s.log[0].reason).toBe('only the firm administrator changes firm standards');
    expect(before).toEqual(['reviewer']);
    expect(s.itemsById.get(id).requiredSignoffs).toEqual(['reviewer', 'partner']);
    expect(reduce(base, []).itemsById.get(id).requiredSignoffs).toEqual(['reviewer']); // the next reduce starts from the packet's standard again
  });
});
